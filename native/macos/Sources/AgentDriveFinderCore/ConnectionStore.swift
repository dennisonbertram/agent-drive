import Darwin
import Foundation

public struct MountDescriptor: Codable, Equatable, CustomStringConvertible {
    public let driveId: String
    public let endpoint: String
    public let token: String
    public let sessionId: String

    public init(connection: MountConnection, sessionId: String) throws {
        guard let session = UUID(uuidString: sessionId) else {
            throw BridgeClientError.invalidConnection
        }
        driveId = connection.driveId
        endpoint = connection.endpoint.absoluteString
        token = connection.token
        self.sessionId = session.uuidString.lowercased()
    }

    public var connection: MountConnection? {
        guard let url = URL(string: endpoint), url.scheme == "http", url.host == "127.0.0.1",
              url.path == "/rpc", url.query == nil, url.fragment == nil,
              let port = url.port
        else { return nil }
        return try? MountConnection(driveId: driveId, port: port, token: token)
    }

    public var description: String {
        "MountDescriptor(driveId: \(driveId), endpoint: \(endpoint), sessionId: \(sessionId), token: <redacted>)"
    }
}

/// Stores only the loopback endpoint and short-lived bearer shared with the File Provider process.
public struct ConnectionStore {
    public let directory: URL

    public init(directory: URL) throws {
        self.directory = directory
        var info = stat()
        if lstat(directory.path, &info) == 0 {
            guard (info.st_mode & S_IFMT) == S_IFDIR else {
                throw BridgeClientError.rejected
            }
        } else if errno == ENOENT {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        } else {
            throw BridgeClientError.rejected
        }
        guard chmod(directory.path, 0o700) == 0 else { throw BridgeClientError.rejected }
    }

    public func startSession(_ descriptor: MountDescriptor) throws -> MountSession {
        guard descriptor.connection != nil else { throw BridgeClientError.invalidConnection }
        let lockURL = lockURL(descriptor.driveId)
        let lockFD = open(lockURL.path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard lockFD >= 0 else { throw BridgeClientError.rejected }
        guard flock(lockFD, LOCK_EX | LOCK_NB) == 0 else {
            _ = close(lockFD)
            throw BridgeClientError.rejected
        }
        do {
            try writeDescriptor(descriptor)
            return MountSession(store: self, descriptor: descriptor, lockFD: lockFD)
        } catch {
            _ = flock(lockFD, LOCK_UN)
            _ = close(lockFD)
            throw error
        }
    }

    public func load(driveId: String) throws -> MountDescriptor {
        guard let uuid = UUID(uuidString: driveId) else { throw BridgeClientError.invalidConnection }
        let data = try readDescriptorData(driveId: uuid.uuidString.lowercased())
        guard let descriptor = try? JSONDecoder().decode(MountDescriptor.self, from: data),
              descriptor.driveId == uuid.uuidString.lowercased(), descriptor.connection != nil
        else { throw BridgeClientError.unavailable }
        return descriptor
    }

    fileprivate func writeDescriptor(_ descriptor: MountDescriptor) throws {
        let bytes = try JSONEncoder().encode(descriptor)
        let target = descriptorURL(descriptor.driveId)
        let temporary = directory.appendingPathComponent(
            ".\(descriptor.driveId).\(descriptor.sessionId).tmp"
        )
        let fd = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw BridgeClientError.rejected }
        var isOpen = true
        do {
            try writeAll(bytes, to: fd)
            guard fsync(fd) == 0 else { throw BridgeClientError.rejected }
            guard close(fd) == 0 else { throw BridgeClientError.rejected }
            isOpen = false
            guard rename(temporary.path, target.path) == 0 else { throw BridgeClientError.rejected }
        } catch {
            if isOpen { _ = close(fd) }
            _ = unlink(temporary.path)
            throw error
        }
    }

    fileprivate func removeIfOwned(_ descriptor: MountDescriptor) throws {
        let target = descriptorURL(descriptor.driveId)
        guard let data = try? readDescriptorData(driveId: descriptor.driveId) else { return }
        guard let current = try? JSONDecoder().decode(MountDescriptor.self, from: data),
              current.sessionId == descriptor.sessionId else { return }
        guard unlink(target.path) == 0 || errno == ENOENT else { throw BridgeClientError.rejected }
    }

    fileprivate func owns(_ descriptor: MountDescriptor) -> Bool {
        guard let data = try? readDescriptorData(driveId: descriptor.driveId),
              let current = try? JSONDecoder().decode(MountDescriptor.self, from: data)
        else { return false }
        return current.driveId == descriptor.driveId && current.sessionId == descriptor.sessionId
    }

    private func readDescriptorData(driveId: String) throws -> Data {
        let fd = open(descriptorURL(driveId).path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw BridgeClientError.unavailable }
        defer { _ = close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              (info.st_mode & 0o777) == 0o600, info.st_size >= 0, info.st_size <= 4_096
        else { throw BridgeClientError.unavailable }
        var data = Data(count: Int(info.st_size))
        let count = data.withUnsafeMutableBytes { bytes -> Int in
            guard let base = bytes.baseAddress else { return 0 }
            return Darwin.read(fd, base, bytes.count)
        }
        guard count == data.count else { throw BridgeClientError.unavailable }
        return data
    }

    private func descriptorURL(_ driveId: String) -> URL {
        directory.appendingPathComponent("connection-\(driveId).json", isDirectory: false)
    }

    private func lockURL(_ driveId: String) -> URL {
        directory.appendingPathComponent("lock-\(driveId)", isDirectory: false)
    }

    private func writeAll(_ data: Data, to fd: Int32) throws {
        try data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            var written = 0
            while written < raw.count {
                let count = Darwin.write(fd, base.advanced(by: written), raw.count - written)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw BridgeClientError.rejected }
                written += count
            }
        }
    }
}

/// Retains the exclusive per-drive lock for the helper lifetime. A crashed helper
/// releases the kernel lock, allowing the next session to replace its stale descriptor.
public final class MountSession: @unchecked Sendable {
    private let store: ConnectionStore
    private let descriptor: MountDescriptor
    private let lockFD: Int32
    private let stateLock = NSLock()
    private var isClosed = false

    fileprivate init(store: ConnectionStore, descriptor: MountDescriptor, lockFD: Int32) {
        self.store = store
        self.descriptor = descriptor
        self.lockFD = lockFD
    }

    public var isCurrentOwner: Bool { store.owns(descriptor) }

    public func close() throws {
        let shouldClose = stateLock.withLock {
            guard !isClosed else { return false }
            isClosed = true
            return true
        }
        guard shouldClose else { return }
        defer {
            _ = flock(lockFD, LOCK_UN)
            _ = Darwin.close(lockFD)
        }
        try store.removeIfOwned(descriptor)
    }

    deinit { try? close() }
}
