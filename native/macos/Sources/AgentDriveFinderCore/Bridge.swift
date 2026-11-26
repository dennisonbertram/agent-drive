import Foundation

public enum BridgeClientError: Error, Equatable {
    case invalidConnection
    case invalidPath
    case invalidRead
    case unavailable
    case rejected
    case malformedResponse
    case remote(String)
    case remoteFailure(RPCFailure)
}

public struct RPCFailure: Equatable, Error {
    public let errno: String
    public let recoveryPath: String?
    public let currentVersionId: String?
}

public struct MountConnection: CustomStringConvertible, Equatable {
    public let driveId: String
    public let port: Int
    public let token: String

    public init(driveId: String, port: Int, token: String) throws {
        guard let uuid = UUID(uuidString: driveId), (1...65_535).contains(port),
              !token.isEmpty, token.utf8.count <= 512,
              token.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
        else { throw BridgeClientError.invalidConnection }
        self.driveId = uuid.uuidString.lowercased()
        self.port = port
        self.token = token
    }

    public var endpoint: URL {
        URL(string: "http://127.0.0.1:\(port)/rpc")!
    }

    public var description: String {
        "MountConnection(driveId: \(driveId), port: \(port), token: <redacted>)"
    }
}

public struct ItemPath: Equatable {
    public let path: String
    public static let rootIdentifier = "root"

    public init(identifier: String) throws {
        if identifier == Self.rootIdentifier {
            path = "/"
            return
        }
        guard identifier.hasPrefix("p:"),
              let data = Data(base64URL: String(identifier.dropFirst(2))),
              let value = String(data: data, encoding: .utf8),
              Self.isCanonical(value), Self.identifier(for: value) == identifier
        else { throw BridgeClientError.invalidPath }
        path = value
    }

    public static func identifier(for path: String) -> String {
        "p:" + Data(path.utf8).base64URLString
    }

    public static func parentPath(for path: String) -> String {
        guard path != "/" else { return "/" }
        let parent = (path as NSString).deletingLastPathComponent
        return parent.isEmpty ? "/" : parent
    }

    public static func isCanonical(_ path: String) -> Bool {
        guard path.utf8.count <= 1_024, path.hasPrefix("/"), !path.contains("\\"),
              !path.contains("\0"), !path.contains("//"),
              path == "/" || !path.hasSuffix("/")
        else { return false }
        return path.split(separator: "/", omittingEmptySubsequences: true)
            .allSatisfy { $0 != "." && $0 != ".." }
    }
}

public struct BridgeEntry: Decodable, Equatable {
    public let name: String
    public let kind: String
    public let size: Int64
    public let mtimeMs: Int64
    public let versionId: String?

    public init(name: String, kind: String, size: Int64, mtimeMs: Int64, versionId: String?) {
        self.name = name
        self.kind = kind
        self.size = size
        self.mtimeMs = mtimeMs
        self.versionId = versionId
    }

    public var isDirectory: Bool { kind == "directory" }

    public func validate() throws {
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"),
              !name.contains("\\"), !name.contains("\0"), size >= 0,
              kind == "file" || kind == "directory",
              (kind == "directory" || (versionId?.isEmpty == false))
        else { throw BridgeClientError.malformedResponse }
    }
}

public struct BridgePage: Decodable, Equatable {
    public let entries: [BridgeEntry]
    public let nextCursor: String?

    public func validate() throws {
        for entry in entries { try entry.validate() }
        if let nextCursor, nextCursor.utf8.count > 4_096 {
            throw BridgeClientError.malformedResponse
        }
    }
}

/// An aligned, bounded remote byte range and its offset in the full file.
public struct AlignedByteRange: Equatable {
    public let offset: Int64
    public let length: Int64

    public init(offset: Int64, length: Int64) {
        self.offset = offset
        self.length = length
    }

    public static func covering(
        offset: Int64,
        length: Int64,
        alignment: Int,
        fileSize: Int64
    ) throws -> AlignedByteRange {
        guard offset >= 0, length > 0, fileSize >= 0, alignment > 0,
              offset <= fileSize, length <= fileSize - offset
        else { throw BridgeClientError.invalidRead }

        let unit = Int64(alignment)
        let start = (offset / unit) * unit
        let requestedEnd = offset + length // Safe because length <= fileSize - offset.
        let remainder = requestedEnd % unit
        let alignedEnd: Int64
        if remainder == 0 || requestedEnd == fileSize {
            alignedEnd = requestedEnd
        } else {
            let padding = unit - remainder
            alignedEnd = padding > fileSize - requestedEnd ? fileSize : requestedEnd + padding
        }
        return AlignedByteRange(offset: start, length: alignedEnd - start)
    }
}

public struct MountCapabilities: Decodable, Equatable {
    public let readOnly: Bool
    public let write: Bool
    public let delete: Bool
    public let writePaths: [String]
    public let maxReadBytes: Int
    public let maxWriteBytes: Int
    public let ops: Set<String>

    public func validate() throws {
        guard (1...1_048_576).contains(maxReadBytes),
              (0...1_048_576).contains(maxWriteBytes),
              writePaths.count <= 16, writePaths.allSatisfy(ItemPath.isCanonical),
              ops.count <= 64,
              ops.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 64 &&
                  $0.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) })
        else { throw BridgeClientError.malformedResponse }
    }

    public func allowsWrite(_ path: String) -> Bool {
        guard !readOnly, write, maxWriteBytes > 0,
              ["openWrite", "write", "truncate", "flush", "release"].allSatisfy(ops.contains),
              ItemPath.isCanonical(path)
        else { return false }
        return writePaths.isEmpty || writePaths.contains(where: { contains($0, path: path) })
    }

    public func allowsDelete(_ path: String) -> Bool {
        guard !readOnly, delete, ops.contains("unlink"), ops.contains("rmdir"), ItemPath.isCanonical(path) else {
            return false
        }
        return writePaths.isEmpty || writePaths.contains(where: { contains($0, path: path) })
    }

    public func allowsRename(from path: String, to destination: String) -> Bool {
        guard allowsWrite(path), allowsWrite(destination), ops.contains("rename") else { return false }
        return true
    }

    public func allowsRenaming(_ path: String) -> Bool {
        !readOnly && write && ops.contains("rename") && ItemPath.isCanonical(path) &&
            (writePaths.isEmpty || writePaths.contains(where: { contains($0, path: path) }))
    }

    public func allowsCreatingChildren(of path: String) -> Bool {
        guard !readOnly, write, ops.contains("mkdir"), ItemPath.isCanonical(path) else { return false }
        return writePaths.isEmpty || writePaths.contains(where: { root in
            contains(root, path: path) || contains(path, path: root)
        })
    }

    public func allowsCreating(_ target: String, under parent: String) -> Bool {
        guard allowsCreatingChildren(of: parent), ItemPath.isCanonical(target), target != "/",
              (target as NSString).deletingLastPathComponent == parent
        else { return false }
        return writePaths.isEmpty || writePaths.contains(where: { contains($0, path: target) })
    }

    public func allowsListing(_ path: String) -> Bool {
        ops.contains("list") && ops.contains("stat") && ItemPath.isCanonical(path)
    }

    public func allowsReading(_ path: String) -> Bool {
        ops.contains("read") && ops.contains("stat") && ItemPath.isCanonical(path)
    }

    private func contains(_ root: String, path: String) -> Bool {
        root == "/" || path == root || path.hasPrefix(root + "/")
    }
}

public struct DriveBridge {
    private let connection: MountConnection
    private let session: URLSession

    public init(connection: MountConnection, session: URLSession = .shared) {
        self.connection = connection
        self.session = session
    }

    public func list(path: String, cursor: String? = nil) async throws -> BridgePage {
        guard ItemPath.isCanonical(path), cursor.map({ $0.utf8.count <= 4_096 }) ?? true else {
            throw BridgeClientError.invalidPath
        }
        let payload = try await request(op: "list", path: path, cursor: cursor)
        let page = try JSONDecoder().decode(BridgePage.self, from: payload)
        try page.validate()
        return page
    }

    public func stat(path: String) async throws -> BridgeEntry {
        guard ItemPath.isCanonical(path) else { throw BridgeClientError.invalidPath }
        let payload = try await request(op: "stat", path: path)
        let response = try JSONDecoder().decode(EntryResponse.self, from: payload)
        try response.entry.validate()
        return response.entry
    }

    public func stat(path: String, versionId: String) async throws -> BridgeEntry {
        guard ItemPath.isCanonical(path), UUID(uuidString: versionId) != nil else {
            throw BridgeClientError.invalidPath
        }
        let payload = try await request(op: "stat", path: path, versionId: versionId)
        let response = try JSONDecoder().decode(EntryResponse.self, from: payload)
        try response.entry.validate()
        guard let returnedVersionId = response.entry.versionId,
              UUID(uuidString: returnedVersionId) == UUID(uuidString: versionId)
        else { throw BridgeClientError.malformedResponse }
        return response.entry
    }

    public func read(path: String, versionId: String, offset: Int64, size: Int) async throws -> Data {
        guard ItemPath.isCanonical(path), !versionId.isEmpty,
              offset >= 0, (0...1_048_576).contains(size)
        else { throw BridgeClientError.invalidRead }
        let payload = try await request(
            op: "read", path: path, versionId: versionId, offset: offset, size: Int64(size)
        )
        let response = try JSONDecoder().decode(DataResponse.self, from: payload)
        guard let data = Data(base64Encoded: response.data), data.count <= size else {
            throw BridgeClientError.malformedResponse
        }
        return data
    }

    public func capabilities() async throws -> MountCapabilities {
        let payload = try await request(op: "capabilities")
        let response = try JSONDecoder().decode(CapabilitiesResponse.self, from: payload)
        try response.capabilities.validate()
        return response.capabilities
    }

    public func openWrite(
        path: String,
        baseVersionId: String?,
        size: Int64? = nil,
        truncateOnOpen: Bool = false
    ) async throws -> OpenWriteResult {
        guard ItemPath.isCanonical(path), size.map({ $0 >= 0 }) ?? true,
              !(truncateOnOpen && (size ?? 0) > 0),
              baseVersionId.map({ !$0.isEmpty && $0.utf8.count <= 512 }) ?? true
        else { throw BridgeClientError.invalidPath }
        let payload = try await request(
            op: "openWrite", path: path, size: size, baseVersionId: baseVersionId,
            explicitBaseVersion: true, truncateOnOpen: truncateOnOpen
        )
        return try JSONDecoder().decode(OpenWriteResult.self, from: payload).validated()
    }

    public func write(handleId: String, offset: Int64, data: Data) async throws -> Int {
        guard validHandle(handleId), offset >= 0, !data.isEmpty, data.count <= 1_048_576 else {
            throw BridgeClientError.invalidRead
        }
        let payload = try await request(
            op: "write", offset: offset, handleId: handleId, data: data.base64EncodedString()
        )
        let response = try JSONDecoder().decode(WriteResponse.self, from: payload)
        guard response.bytesWritten == data.count else { throw BridgeClientError.malformedResponse }
        return response.bytesWritten
    }

    public func truncate(handleId: String, size: Int64) async throws {
        guard validHandle(handleId), size >= 0 else { throw BridgeClientError.invalidRead }
        let payload = try await request(op: "truncate", size: size, handleId: handleId)
        let response = try JSONDecoder().decode(SizeResponse.self, from: payload)
        guard response.size == size else { throw BridgeClientError.malformedResponse }
    }

    public func readStaged(handleId: String, offset: Int64, size: Int) async throws -> (Data, Bool) {
        guard validHandle(handleId), offset >= 0, (0...1_048_576).contains(size) else {
            throw BridgeClientError.invalidRead
        }
        let payload = try await request(op: "readStaged", offset: offset, size: Int64(size), handleId: handleId)
        let response = try JSONDecoder().decode(StagedDataResponse.self, from: payload)
        guard let data = Data(base64Encoded: response.data), data.count <= size else {
            throw BridgeClientError.malformedResponse
        }
        return (data, response.eof)
    }

    public func flush(handleId: String) async throws -> FlushResult {
        guard validHandle(handleId) else { throw BridgeClientError.invalidRead }
        let payload = try await request(op: "flush", handleId: handleId)
        return try JSONDecoder().decode(FlushResult.self, from: payload).validated()
    }

    public func release(handleId: String) async throws {
        guard validHandle(handleId) else { throw BridgeClientError.invalidRead }
        _ = try await request(op: "release", handleId: handleId)
    }

    public func mkdir(path: String) async throws {
        guard ItemPath.isCanonical(path), path != "/" else { throw BridgeClientError.invalidPath }
        _ = try await request(op: "mkdir", path: path)
    }

    public func rmdir(path: String) async throws {
        guard ItemPath.isCanonical(path), path != "/" else { throw BridgeClientError.invalidPath }
        _ = try await request(op: "rmdir", path: path)
    }

    public func unlink(path: String, ifVersionId: String) async throws {
        guard ItemPath.isCanonical(path), path != "/", UUID(uuidString: ifVersionId) != nil else {
            throw BridgeClientError.invalidPath
        }
        _ = try await request(op: "unlink", path: path, ifVersionId: ifVersionId)
    }

    public func rename(
        path: String,
        destinationPath: String,
        ifSourceVersionId: String,
        ifDestinationVersionId: String? = nil,
        operationId: String? = nil
    ) async throws -> RenameResult {
        let resolvedOperationId = operationId ?? UUID().uuidString.lowercased()
        guard ItemPath.isCanonical(path), path != "/", ItemPath.isCanonical(destinationPath),
              destinationPath != "/", UUID(uuidString: ifSourceVersionId) != nil,
              ifDestinationVersionId.map({ UUID(uuidString: $0) != nil }) ?? true,
              UUID(uuidString: resolvedOperationId) != nil
        else { throw BridgeClientError.invalidPath }
        let payload = try await request(
            op: "rename", path: path, ifSourceVersionId: ifSourceVersionId,
            destinationPath: destinationPath, destinationVersionId: ifDestinationVersionId,
            operationId: resolvedOperationId, explicitDestinationVersion: true
        )
        return try JSONDecoder().decode(RenameResponse.self, from: payload).entry.validated()
    }

    private func request(
        op: String,
        path: String? = nil,
        cursor: String? = nil,
        versionId: String? = nil,
        offset: Int64? = nil,
        size: Int64? = nil,
        handleId: String? = nil,
        data: String? = nil,
        baseVersionId: String? = nil,
        explicitBaseVersion: Bool = false,
        ifVersionId: String? = nil,
        ifSourceVersionId: String? = nil,
        destinationPath: String? = nil,
        destinationVersionId: String? = nil,
        operationId: String? = nil,
        explicitDestinationVersion: Bool = false,
        truncateOnOpen: Bool = false
    ) async throws -> Data {
        let id = UUID().uuidString.lowercased()
        var request = URLRequest(url: connection.endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(RPCRequest(
            id: id, op: op, path: path, cursor: cursor,
            versionId: versionId, offset: offset, size: size, handleId: handleId,
            data: data, baseVersionId: baseVersionId,
            explicitBaseVersion: explicitBaseVersion, destinationPath: destinationPath,
            destinationVersionId: destinationVersionId, operationId: operationId,
            ifVersionId: ifVersionId, ifSourceVersionId: ifSourceVersionId,
            explicitDestinationVersion: explicitDestinationVersion,
            truncateOnOpen: truncateOnOpen
        ))
        let requestLimit = op == "write" ? 1_500_000 : 64_000
        guard (request.httpBody?.count ?? Int.max) <= requestLimit else {
            throw BridgeClientError.invalidRead
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw BridgeClientError.unavailable
        }
        guard let http = response as? HTTPURLResponse else {
            throw BridgeClientError.malformedResponse
        }
        guard http.statusCode == 200 else {
            throw http.statusCode == 401 || http.statusCode == 403
                ? BridgeClientError.rejected : BridgeClientError.unavailable
        }
        let responseLimit = (op == "read" || op == "readStaged") ? 1_500_000 : 64_000
        guard data.count <= responseLimit else { throw BridgeClientError.malformedResponse }
        let envelope: RPCEnvelope
        do { envelope = try JSONDecoder().decode(RPCEnvelope.self, from: data) }
        catch { throw BridgeClientError.malformedResponse }
        guard envelope.id == id else { throw BridgeClientError.malformedResponse }
        guard envelope.ok else {
            if let errno = envelope.errno {
                guard !errno.isEmpty, errno.utf8.count <= 32,
                      errno.unicodeScalars.allSatisfy({
                          (65...90).contains(Int($0.value)) || (48...57).contains(Int($0.value)) || $0.value == 95
                      }),
                      envelope.recoveryPath.map({
                          $0.hasPrefix("/") && $0.utf8.count <= 4_096 &&
                              $0.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
                      }) ?? true,
                      envelope.currentVersionId.map({ !$0.isEmpty && $0.utf8.count <= 512 &&
                          $0.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
                      }) ?? true
                else { throw BridgeClientError.malformedResponse }
                throw BridgeClientError.remoteFailure(RPCFailure(
                    errno: errno,
                    recoveryPath: envelope.recoveryPath,
                    currentVersionId: envelope.currentVersionId
                ))
            }
            throw BridgeClientError.remote("EIO")
        }
        return data
    }

    private func validHandle(_ handleId: String) -> Bool {
        !handleId.isEmpty && handleId.utf8.count <= 256 &&
            handleId.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
    }

}

private struct RPCRequest: Encodable {
    let id: String
    let op: String
    let path: String?
    let cursor: String?
    let versionId: String?
    let offset: Int64?
    let size: Int64?
    let handleId: String?
    let data: String?
    let baseVersionId: String?
    let explicitBaseVersion: Bool
    let destinationPath: String?
    let destinationVersionId: String?
    let operationId: String?
    let ifVersionId: String?
    let ifSourceVersionId: String?
    let explicitDestinationVersion: Bool
    let truncateOnOpen: Bool

    enum CodingKeys: String, CodingKey {
        case id, op, path, cursor, versionId, offset, size, handleId, data
        case baseVersionId, destinationPath
        case destinationVersionId = "ifDestinationVersionId"
        case operationId, ifVersionId, ifSourceVersionId, truncateOnOpen
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(op, forKey: .op)
        try container.encodeIfPresent(path, forKey: .path)
        try container.encodeIfPresent(cursor, forKey: .cursor)
        try container.encodeIfPresent(versionId, forKey: .versionId)
        try container.encodeIfPresent(offset, forKey: .offset)
        try container.encodeIfPresent(size, forKey: .size)
        try container.encodeIfPresent(handleId, forKey: .handleId)
        try container.encodeIfPresent(data, forKey: .data)
        if explicitBaseVersion { try container.encode(baseVersionId, forKey: .baseVersionId) }
        else { try container.encodeIfPresent(baseVersionId, forKey: .baseVersionId) }
        try container.encodeIfPresent(destinationPath, forKey: .destinationPath)
        if explicitDestinationVersion { try container.encode(destinationVersionId, forKey: .destinationVersionId) }
        else { try container.encodeIfPresent(destinationVersionId, forKey: .destinationVersionId) }
        try container.encodeIfPresent(operationId, forKey: .operationId)
        try container.encodeIfPresent(ifVersionId, forKey: .ifVersionId)
        try container.encodeIfPresent(ifSourceVersionId, forKey: .ifSourceVersionId)
        if truncateOnOpen { try container.encode(true, forKey: .truncateOnOpen) }
    }
}

private struct RPCEnvelope: Decodable {
    let id: String
    let ok: Bool
    let errno: String?
    let recoveryPath: String?
    let currentVersionId: String?
}

private struct CapabilitiesResponse: Decodable { let capabilities: MountCapabilities }
private struct EntryResponse: Decodable { let entry: BridgeEntry }
private struct RenameResponse: Decodable { let entry: RenameResult }
private struct DataResponse: Decodable { let data: String }
public struct OpenWriteResult: Decodable, Equatable {
    public let handleId: String
    public let recoveryPath: String
    public let size: Int64
    fileprivate func validated() throws -> Self {
        guard !handleId.isEmpty, handleId.utf8.count <= 256,
              handleId.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }),
              recoveryPath.hasPrefix("/"), recoveryPath.utf8.count <= 4_096,
              recoveryPath.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }),
              size >= 0
        else { throw BridgeClientError.malformedResponse }
        return self
    }
}
private struct WriteResponse: Decodable { let bytesWritten: Int }
private struct SizeResponse: Decodable { let size: Int64 }
private struct StagedDataResponse: Decodable { let data: String; let eof: Bool }
public struct FlushResult: Decodable, Equatable {
    public let version: String
    public let recoveryPath: String?
    fileprivate func validated() throws -> Self {
        guard !version.isEmpty, version.utf8.count <= 512,
              version.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }),
              recoveryPath.map({ $0.hasPrefix("/") && $0.utf8.count <= 4_096 &&
                  $0.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
              }) ?? true
        else { throw BridgeClientError.malformedResponse }
        return self
    }
}
public struct RenameResult: Decodable, Equatable {
    public let id: String
    public let path: String
    public let versionId: String
    fileprivate func validated() throws -> Self {
        guard UUID(uuidString: id) != nil, ItemPath.isCanonical(path),
              !versionId.isEmpty, versionId.utf8.count <= 512
        else { throw BridgeClientError.malformedResponse }
        return self
    }
}

private extension Data {
    init?(base64URL value: String) {
        var encoded = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padding = (4 - encoded.count % 4) % 4
        encoded += String(repeating: "=", count: padding)
        self.init(base64Encoded: encoded)
    }

    var base64URLString: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
