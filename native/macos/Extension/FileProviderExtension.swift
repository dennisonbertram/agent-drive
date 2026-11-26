import FileProvider
import Darwin
import Foundation
import UniformTypeIdentifiers

final class FileProviderExtension: NSObject, NSFileProviderReplicatedExtension, NSFileProviderPartialContentFetching {
    private let domain: NSFileProviderDomain
    private let connection: MountConnection?
    private let capabilityTask: Task<MountCapabilities, Error>?

    required init(domain: NSFileProviderDomain) {
        self.domain = domain
        do {
            let prefix = "agent-drive-"
            guard domain.identifier.rawValue.hasPrefix(prefix) else {
                throw BridgeClientError.invalidConnection
            }
            let driveId = String(domain.identifier.rawValue.dropFirst(prefix.count))
            guard let group = Bundle.main.object(forInfoDictionaryKey: "AgentDriveAppGroup") as? String,
                  !group.contains("$("),
                  let container = FileManager.default.containerURL(
                    forSecurityApplicationGroupIdentifier: group
                  )
            else { throw BridgeClientError.unavailable }
            let store = try ConnectionStore(
                directory: container.appendingPathComponent("AgentDriveFinder", isDirectory: true)
            )
            let descriptor = try store.load(driveId: driveId)
            guard let connection = descriptor.connection else { throw BridgeClientError.unavailable }
            self.connection = connection
            self.capabilityTask = Task { try await DriveBridge(connection: connection).capabilities() }
        } catch {
            self.connection = nil
            self.capabilityTask = nil
        }
        super.init()
    }

    func invalidate() {}

    func item(for identifier: NSFileProviderItemIdentifier, request: NSFileProviderRequest,
              completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        guard let capabilityTask else {
            completionHandler(nil, providerError(BridgeClientError.unavailable))
            return progress
        }
        if identifier == .rootContainer {
            Task {
                do {
                    let capabilities = try await capabilityTask.value
                    completionHandler(FileProviderItem.root(domain: domain, capabilities: capabilities), nil)
                } catch {
                    completionHandler(nil, providerError(error))
                }
            }
            return progress
        }
        guard let connection else {
            completionHandler(nil, providerError(BridgeClientError.unavailable))
            return progress
        }
        do {
            let itemPath = try ItemPath(identifier: identifier.rawValue).path
            let client = DriveBridge(connection: connection)
            Task {
                do {
                    async let entry = client.stat(path: itemPath)
                    async let capabilities = capabilityTask.value
                    completionHandler(
                        FileProviderItem(path: itemPath, entry: try await entry, capabilities: try await capabilities),
                        nil
                    )
                } catch {
                    completionHandler(nil, providerError(error))
                }
            }
        } catch {
            completionHandler(nil, providerError(error))
        }
        return progress
    }

    func enumerator(for identifier: NSFileProviderItemIdentifier,
                    request: NSFileProviderRequest) throws -> NSFileProviderEnumerator {
        guard let connection else { throw BridgeClientError.unavailable }
        guard let capabilityTask else { throw BridgeClientError.unavailable }
        let path: String?
        if identifier == .workingSet { path = nil }
        else if identifier == .rootContainer { path = "/" }
        else { path = try ItemPath(identifier: identifier.rawValue).path }
        return DirectoryEnumerator(path: path, connection: connection, capabilityTask: capabilityTask)
    }

    func fetchContents(for identifier: NSFileProviderItemIdentifier,
                       version requestedVersion: NSFileProviderItemVersion?,
                       request: NSFileProviderRequest,
                       completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 0)
        guard let connection else {
            completionHandler(nil, nil, providerError(BridgeClientError.unavailable))
            return progress
        }
        guard let capabilityTask else {
            completionHandler(nil, nil, providerError(BridgeClientError.unavailable))
            return progress
        }
        let path: String
        do {
            path = try ItemPath(identifier: identifier.rawValue).path
        } catch {
            completionHandler(nil, nil, providerError(error))
            return progress
        }
        let client = DriveBridge(connection: connection)
        let task = Task {
            var temporaryURL: URL?
            do {
                try Task.checkCancellation()
                let mountCapabilities = try await capabilityTask.value
                guard mountCapabilities.allowsReading(path) else { throw BridgeClientError.rejected }
                let latest = try await client.stat(path: path)
                guard latest.kind == "file", let latestVersion = latest.versionId else {
                    throw BridgeClientError.invalidPath
                }
                let pinnedVersion: String
                if let requestedVersion {
                    guard let value = String(data: requestedVersion.contentVersion, encoding: .utf8),
                          UUID(uuidString: value) != nil
                    else { throw BridgeClientError.invalidRead }
                    pinnedVersion = value
                } else {
                    pinnedVersion = latestVersion
                }

                let expectedSize = pinnedVersion == latestVersion ? latest.size : nil
                progress.totalUnitCount = expectedSize ?? 0
                let manager = NSFileProviderManager(for: domain)
                guard let manager else { throw BridgeClientError.unavailable }
                let directory = try manager.temporaryDirectoryURL()
                let target = directory.appendingPathComponent("agent-drive-\(UUID().uuidString).tmp")
                let file = open(target.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
                guard file >= 0 else { throw BridgeClientError.unavailable }
                temporaryURL = target
                var fileOpen = true
                defer { if fileOpen { _ = close(file) } }

                var offset: Int64 = 0
                let chunkSize = min(mountCapabilities.maxReadBytes, 1_048_576)
                while expectedSize.map({ offset < $0 }) ?? true {
                    try Task.checkCancellation()
                    let requested = expectedSize.map { Int(min(Int64(chunkSize), $0 - offset)) } ?? chunkSize
                    let bytes = try await client.read(
                        path: path,
                        versionId: pinnedVersion,
                        offset: offset,
                        size: requested
                    )
                    if expectedSize != nil && bytes.count != requested {
                        throw BridgeClientError.malformedResponse
                    }
                    if bytes.isEmpty { break }
                    try Self.writeAll(bytes, to: file)
                    offset += Int64(bytes.count)
                    progress.completedUnitCount = offset
                    if bytes.count < requested { break }
                }
                if let expectedSize, offset != expectedSize {
                    throw BridgeClientError.malformedResponse
                }
                guard fsync(file) == 0, close(file) == 0 else {
                    fileOpen = false
                    throw BridgeClientError.unavailable
                }
                fileOpen = false
                let resolvedEntry = BridgeEntry(
                    name: latest.name,
                    kind: latest.kind,
                    size: offset,
                    mtimeMs: latest.mtimeMs,
                    versionId: pinnedVersion
                )
                let item = FileProviderItem(path: path, entry: resolvedEntry, capabilities: mountCapabilities)
                completionHandler(target, item, nil)
                temporaryURL = nil // File Provider owns the file after a successful callback.
            } catch {
                if let temporaryURL { _ = unlink(temporaryURL.path) }
                completionHandler(nil, nil, error is CancellationError ?
                    NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError) : providerError(error))
            }
        }
        progress.cancellationHandler = { task.cancel() }
        return progress
    }

    func fetchPartialContents(
        for identifier: NSFileProviderItemIdentifier,
        version requestedVersion: NSFileProviderItemVersion,
        request: NSFileProviderRequest,
        minimalRange requestedRange: NSRange,
        aligningTo alignment: Int,
        options: NSFileProviderFetchContentsOptions,
        completionHandler: @escaping (URL?, NSFileProviderItem?, NSRange, NSFileProviderMaterializationFlags, Error?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: Int64(max(requestedRange.length, 0)))
        guard let connection else {
            completionHandler(nil, nil, requestedRange, [], providerError(BridgeClientError.unavailable))
            return progress
        }
        guard let capabilityTask else {
            completionHandler(nil, nil, requestedRange, [], providerError(BridgeClientError.unavailable))
            return progress
        }
        let path: String
        do {
            path = try ItemPath(identifier: identifier.rawValue).path
            guard requestedRange.location >= 0, requestedRange.length > 0,
                  requestedRange.location <= Int.max - requestedRange.length,
                  alignment > 0
            else { throw BridgeClientError.invalidRead }
        } catch {
            completionHandler(nil, nil, requestedRange, [], providerError(error))
            return progress
        }

        let client = DriveBridge(connection: connection)
        let task = Task {
            var temporaryURL: URL?
            do {
                try Task.checkCancellation()
                let mountCapabilities = try await capabilityTask.value
                guard mountCapabilities.allowsReading(path) else { throw BridgeClientError.rejected }
                let current = try await client.stat(path: path)
                guard current.kind == "file", let versionId = current.versionId else {
                    throw BridgeClientError.invalidPath
                }
                let isStrict = options.contains(.strictVersioning)
                let requestedVersionId = String(data: requestedVersion.contentVersion, encoding: .utf8)
                if isStrict && requestedVersionId != versionId {
                    throw NSError(domain: NSFileProviderErrorDomain, code: -2009)
                }
                let range = try AlignedByteRange.covering(
                    offset: Int64(requestedRange.location),
                    length: Int64(requestedRange.length),
                    alignment: alignment,
                    fileSize: current.size
                )
                progress.totalUnitCount = range.length
                let manager = NSFileProviderManager(for: domain)
                guard let manager else { throw BridgeClientError.unavailable }
                let directory = try manager.temporaryDirectoryURL()
                let target = directory.appendingPathComponent("agent-drive-\(UUID().uuidString).range.tmp")
                let file = open(target.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
                guard file >= 0 else { throw BridgeClientError.unavailable }
                temporaryURL = target
                var fileOpen = true
                defer { if fileOpen { _ = close(file) } }
                let end = range.offset + range.length
                guard ftruncate(file, off_t(end)) == 0 else { throw BridgeClientError.unavailable }

                var position = range.offset
                while position < end {
                    try Task.checkCancellation()
                    let count = Int(min(Int64(min(mountCapabilities.maxReadBytes, 1_048_576)), end - position))
                    let bytes = try await client.read(
                        path: path,
                        versionId: versionId,
                        offset: position,
                        size: count
                    )
                    guard bytes.count == count else { throw BridgeClientError.malformedResponse }
                    try Self.writeAll(bytes, to: file, at: position)
                    position += Int64(bytes.count)
                    progress.completedUnitCount = position - range.offset
                }
                guard fsync(file) == 0, close(file) == 0 else {
                    fileOpen = false
                    throw BridgeClientError.unavailable
                }
                fileOpen = false
                let item = FileProviderItem(path: path, entry: current, capabilities: mountCapabilities)
                let fetched = NSRange(location: Int(range.offset), length: Int(range.length))
                completionHandler(target, item, fetched, [], nil)
                temporaryURL = nil
            } catch {
                if let temporaryURL { _ = unlink(temporaryURL.path) }
                let resolvedError = error is CancellationError
                    ? NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError)
                    : providerError(error)
                completionHandler(nil, nil, requestedRange, [], resolvedError)
            }
        }
        progress.cancellationHandler = { task.cancel() }
        return progress
    }

    func createItem(basedOn itemTemplate: NSFileProviderItem,
                    fields: NSFileProviderItemFields,
                    contents url: URL?,
                    options: NSFileProviderCreateItemOptions,
                    request: NSFileProviderRequest,
                    completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 0)
        guard let connection, let capabilityTask else {
            completionHandler(nil, [], false, providerError(BridgeClientError.unavailable))
            return progress
        }
        let path: String
        do {
            path = try childPath(parent: itemTemplate.parentItemIdentifier, name: itemTemplate.filename)
        } catch {
            completionHandler(nil, [], false, providerError(error))
            return progress
        }
        let isDirectory = itemTemplate.contentType?.conforms(to: .folder) == true
        let client = DriveBridge(connection: connection)
        let task = Task {
            do {
                try Task.checkCancellation()
                let mountCapabilities = try await capabilityTask.value
                let parentPath = itemTemplate.parentItemIdentifier == .rootContainer
                    ? "/" : try ItemPath(identifier: itemTemplate.parentItemIdentifier.rawValue).path
                let entry: BridgeEntry
                if isDirectory {
                    guard url == nil,
                          mountCapabilities.allowsCreating(path, under: parentPath)
                    else { throw BridgeClientError.rejected }
                    try await client.mkdir(path: path)
                    entry = BridgeEntry(
                        name: itemTemplate.filename,
                        kind: "directory",
                        size: 0,
                        mtimeMs: Int64(Date().timeIntervalSince1970 * 1_000),
                        versionId: nil
                    )
                } else {
                    guard mountCapabilities.allowsWrite(path) else { throw BridgeClientError.rejected }
                    let result = try await stageAndCommit(
                        client: client,
                        path: path,
                        baseVersionId: nil,
                        contents: url,
                        capabilities: mountCapabilities,
                        progress: progress
                    )
                    entry = BridgeEntry(
                        name: itemTemplate.filename,
                        kind: "file",
                        size: result.size,
                        mtimeMs: Int64(Date().timeIntervalSince1970 * 1_000),
                        versionId: result.flush.version
                    )
                }
                let item = FileProviderItem(path: path, entry: entry, capabilities: mountCapabilities)
                let supported: NSFileProviderItemFields = [.contents, .filename, .parentItemIdentifier]
                completionHandler(item, fields.subtracting(supported), false, nil)
            } catch {
                completionHandler(nil, [], false, providerError(error))
            }
        }
        progress.cancellationHandler = { task.cancel() }
        return progress
    }

    func modifyItem(_ item: NSFileProviderItem,
                    baseVersion version: NSFileProviderItemVersion,
                    changedFields: NSFileProviderItemFields,
                    contents newContents: URL?,
                    options: NSFileProviderModifyItemOptions,
                    request: NSFileProviderRequest,
                    completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        guard let connection, let capabilityTask else {
            completionHandler(nil, [], false, providerError(BridgeClientError.unavailable))
            return progress
        }
        let oldPath: String
        do { oldPath = try ItemPath(identifier: item.itemIdentifier.rawValue).path }
        catch {
            completionHandler(nil, [], false, providerError(error))
            return progress
        }
        let nameOrParentChanged = changedFields.contains(.filename) || changedFields.contains(.parentItemIdentifier)
        let proposedPath: String
        do {
            proposedPath = nameOrParentChanged
                ? try childPath(parent: item.parentItemIdentifier, name: item.filename)
                : oldPath
        } catch {
            completionHandler(nil, [], false, providerError(error))
            return progress
        }
        let locationChanged = proposedPath != oldPath
        let client = DriveBridge(connection: connection)
        let task = Task {
            do {
                try Task.checkCancellation()
                let mountCapabilities = try await capabilityTask.value
                let current = try await client.stat(path: oldPath)
                let contentChanged = changedFields.contains(.contents)
                guard !contentChanged || (newContents != nil && !current.isDirectory) else {
                    throw BridgeClientError.invalidRead
                }
                var entry = current
                if contentChanged {
                    guard mountCapabilities.allowsWrite(oldPath) else { throw BridgeClientError.rejected }
                    let committed = try await stageAndCommit(
                        client: client,
                        path: oldPath,
                        baseVersionId: version.contentVersionString,
                        contents: newContents,
                        capabilities: mountCapabilities,
                        progress: progress
                    )
                    entry = BridgeEntry(
                        name: current.name,
                        kind: current.kind,
                        size: committed.size,
                        mtimeMs: Int64(Date().timeIntervalSince1970 * 1_000),
                        versionId: committed.flush.version
                    )
                }

                let pendingLocation: NSFileProviderItemFields = [.filename, .parentItemIdentifier]
                if contentChanged && locationChanged {
                    let updated = FileProviderItem(path: oldPath, entry: entry, capabilities: mountCapabilities)
                    completionHandler(updated, changedFields.intersection(pendingLocation), false, nil)
                    return
                }
                let resultPath: String
                if locationChanged {
                    let destination = proposedPath
                    guard mountCapabilities.allowsRename(from: oldPath, to: destination) else {
                        throw BridgeClientError.rejected
                    }
                    let sourceVersion = version.contentVersionString
                    guard let sourceVersion else { throw BridgeClientError.invalidRead }
                    let renamed = try await client.rename(
                        path: oldPath,
                        destinationPath: destination,
                        ifSourceVersionId: sourceVersion
                    )
                    resultPath = renamed.path
                    entry = BridgeEntry(
                        name: item.filename,
                        kind: current.kind,
                        size: entry.size,
                        mtimeMs: entry.mtimeMs,
                        versionId: renamed.versionId
                    )
                } else {
                    resultPath = oldPath
                }
                let updated = FileProviderItem(path: resultPath, entry: entry, capabilities: mountCapabilities)
                let supported: NSFileProviderItemFields = [.contents, .filename, .parentItemIdentifier]
                completionHandler(updated, changedFields.subtracting(supported), false, nil)
            } catch {
                completionHandler(nil, [], false, providerError(error))
            }
        }
        progress.cancellationHandler = { task.cancel() }
        return progress
    }

    func deleteItem(identifier: NSFileProviderItemIdentifier,
                    baseVersion version: NSFileProviderItemVersion,
                    options: NSFileProviderDeleteItemOptions,
                    request: NSFileProviderRequest,
                    completionHandler: @escaping (Error?) -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        guard let connection, let capabilityTask else {
            completionHandler(providerError(BridgeClientError.unavailable))
            return progress
        }
        let path: String
        do { path = try ItemPath(identifier: identifier.rawValue).path }
        catch {
            completionHandler(providerError(error))
            return progress
        }
        let client = DriveBridge(connection: connection)
        let task = Task {
            do {
                try Task.checkCancellation()
                let mountCapabilities = try await capabilityTask.value
                guard mountCapabilities.allowsDelete(path) else { throw BridgeClientError.rejected }
                let current = try await client.stat(path: path)
                if current.isDirectory {
                    if !options.contains(.recursive) {
                        let children = try await client.list(path: path)
                        if !children.entries.isEmpty || children.nextCursor != nil {
                            throw BridgeClientError.remote("ENOTEMPTY")
                        }
                        try await client.rmdir(path: path)
                    } else {
                        try await removeRecursively(path: path, client: client)
                    }
                } else {
                    guard let baseVersion = version.contentVersionString else { throw BridgeClientError.invalidRead }
                    try await client.unlink(path: path, ifVersionId: baseVersion)
                }
                completionHandler(nil)
            } catch {
                completionHandler(providerError(error))
            }
        }
        progress.cancellationHandler = { task.cancel() }
        return progress
    }

    private func readOnlyProgress(_ completion: @escaping (Error) -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        completion(NSError(domain: NSCocoaErrorDomain, code: Int(EROFS)))
        return progress
    }

    private func stageAndCommit(
        client: DriveBridge,
        path: String,
        baseVersionId: String?,
        contents: URL?,
        capabilities: MountCapabilities,
        progress: Progress
    ) async throws -> (flush: FlushResult, size: Int64) {
        let handle = try await client.openWrite(
            path: path, baseVersionId: baseVersionId, truncateOnOpen: true
        )
        do {
            var source: Int32 = -1
            var size: Int64 = 0
            if let contents {
                guard contents.isFileURL else { throw BridgeClientError.invalidPath }
                source = open(contents.path, O_RDONLY | O_NOFOLLOW)
                guard source >= 0 else { throw BridgeClientError.unavailable }
                var info = stat()
                guard fstat(source, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
                      info.st_size >= 0 else {
                    _ = close(source)
                    source = -1
                    throw BridgeClientError.invalidPath
                }
                size = Int64(info.st_size)
            }
            defer { if source >= 0 { _ = close(source) } }
            guard capabilities.maxWriteBytes > 0 else { throw BridgeClientError.rejected }
            let chunkLimit = min(capabilities.maxWriteBytes, 1_048_576)
            try await client.truncate(handleId: handle.handleId, size: size)
            progress.totalUnitCount = size
            var offset: Int64 = 0
            while offset < size {
                try Task.checkCancellation()
                let count = Int(min(Int64(chunkLimit), size - offset))
                var bytes = Data(count: count)
                let bytesRead = bytes.withUnsafeMutableBytes { storage -> Int in
                    guard let base = storage.baseAddress else { return 0 }
                    return Int(Darwin.pread(source, base, count, off_t(offset)))
                }
                if bytesRead < 0 && errno == EINTR { continue }
                guard bytesRead == count else { throw BridgeClientError.unavailable }
                _ = try await client.write(handleId: handle.handleId, offset: offset, data: bytes)
                offset += Int64(bytesRead)
                progress.completedUnitCount = offset
            }
            try Task.checkCancellation()
            let result = try await client.flush(handleId: handle.handleId)
            try? await client.release(handleId: handle.handleId)
            return (result, size)
        } catch {
            try? await client.release(handleId: handle.handleId)
            let errno: String
            if error is CancellationError {
                errno = "ECANCELED"
            } else if let bridgeError = error as? BridgeClientError {
                switch bridgeError {
                case .remoteFailure(let failure):
                    if failure.recoveryPath != nil { throw error }
                    errno = failure.errno
                case .remote(let value): errno = value
                default: errno = "EIO"
                }
            } else { errno = "EIO" }
            throw BridgeClientError.remoteFailure(RPCFailure(
                errno: errno,
                recoveryPath: handle.recoveryPath,
                currentVersionId: nil
            ))
        }
    }

    private func removeRecursively(path: String, client: DriveBridge) async throws {
        var cursor: String?
        repeat {
            let page = try await client.list(path: path, cursor: cursor)
            for entry in page.entries {
                let childPath = path == "/" ? "/\(entry.name)" : "\(path)/\(entry.name)"
                if entry.isDirectory {
                    try await removeRecursively(path: childPath, client: client)
                } else {
                    guard let versionId = entry.versionId else { throw BridgeClientError.malformedResponse }
                    try await client.unlink(path: childPath, ifVersionId: versionId)
                }
            }
            cursor = page.nextCursor
        } while cursor != nil
        try await client.rmdir(path: path)
    }

    private func childPath(parent: NSFileProviderItemIdentifier, name: String) throws -> String {
        guard !name.isEmpty, name != ".", name != "..", name.utf8.count <= 255,
              !name.contains("/"), !name.contains("\\"), !name.contains("\0")
        else { throw BridgeClientError.invalidPath }
        let parentPath = parent == .rootContainer ? "/" : try ItemPath(identifier: parent.rawValue).path
        let path = parentPath == "/" ? "/\(name)" : "\(parentPath)/\(name)"
        guard ItemPath.isCanonical(path) else { throw BridgeClientError.invalidPath }
        return path
    }

    private static func writeAll(_ data: Data, to descriptor: Int32) throws {
        try data.withUnsafeBytes { bytes in
            guard let base = bytes.baseAddress else { return }
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(descriptor, base.advanced(by: offset), bytes.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw BridgeClientError.unavailable }
                offset += count
            }
        }
    }

    private static func writeAll(_ data: Data, to descriptor: Int32, at offset: Int64) throws {
        try data.withUnsafeBytes { bytes in
            guard let base = bytes.baseAddress else { return }
            var written = 0
            while written < bytes.count {
                let count = Darwin.pwrite(
                    descriptor,
                    base.advanced(by: written),
                    bytes.count - written,
                    off_t(offset + Int64(written))
                )
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw BridgeClientError.unavailable }
                written += count
            }
        }
    }
}

private final class FileProviderItem: NSObject, NSFileProviderItem {
    let itemIdentifier: NSFileProviderItemIdentifier
    let parentItemIdentifier: NSFileProviderItemIdentifier
    let filename: String
    let contentType: UTType
    let capabilities: NSFileProviderItemCapabilities
    let documentSize: NSNumber?
    let contentModificationDate: Date?
    let itemVersion: NSFileProviderItemVersion

    init(path: String, entry: BridgeEntry, capabilities mountCapabilities: MountCapabilities) {
        itemIdentifier = path == "/"
            ? .rootContainer : NSFileProviderItemIdentifier(ItemPath.identifier(for: path))
        let parent = (path as NSString).deletingLastPathComponent
        parentItemIdentifier = path == "/" || parent.isEmpty || parent == path
            ? .rootContainer : NSFileProviderItemIdentifier(ItemPath.identifier(for: parent))
        filename = entry.name
        contentType = entry.kind == "directory"
            ? .folder
            : UTType(filenameExtension: (entry.name as NSString).pathExtension) ?? .data
        var itemCapabilities: NSFileProviderItemCapabilities = [.allowsEvicting]
        if entry.kind == "directory" && mountCapabilities.allowsListing(path) {
            itemCapabilities.insert(.allowsContentEnumerating)
        }
        if entry.kind == "file" && mountCapabilities.allowsReading(path) {
            itemCapabilities.insert(.allowsReading)
        }
        if entry.kind == "directory" && mountCapabilities.allowsCreatingChildren(of: path) {
            itemCapabilities.insert(.allowsWriting)
        }
        if entry.kind == "file" && mountCapabilities.allowsWrite(path) {
            itemCapabilities.insert(.allowsWriting)
        }
        if mountCapabilities.allowsDelete(path) { itemCapabilities.insert(.allowsDeleting) }
        if entry.versionId.map({ UUID(uuidString: $0) != nil }) == true && mountCapabilities.allowsRenaming(path) {
            itemCapabilities.insert(.allowsRenaming)
            itemCapabilities.insert(.allowsReparenting)
        }
        capabilities = itemCapabilities
        documentSize = entry.kind == "file" ? NSNumber(value: entry.size) : nil
        contentModificationDate = Date(timeIntervalSince1970: Double(entry.mtimeMs) / 1_000)
        itemVersion = NSFileProviderItemVersion(
            contentVersion: Data((entry.versionId ?? "folder:\(path)").utf8),
            metadataVersion: Data("\(entry.name):\(entry.size):\(entry.mtimeMs)".utf8)
        )
    }

    static func root(domain: NSFileProviderDomain, capabilities: MountCapabilities) -> FileProviderItem {
        FileProviderItem(
            path: "/",
            entry: BridgeEntry(name: domain.displayName, kind: "directory", size: 0, mtimeMs: 0, versionId: nil),
            capabilities: capabilities
        )
    }
}

private final class DirectoryEnumerator: NSObject, NSFileProviderEnumerator {
    private let path: String?
    private let connection: MountConnection
    private let capabilityTask: Task<MountCapabilities, Error>
    private let lock = NSLock()
    private var snapshot: [String: FileProviderItem] = [:]
    private var anchor = ProviderEnumerationState.initialSyncAnchor

    init(path: String?, connection: MountConnection, capabilityTask: Task<MountCapabilities, Error>) {
        self.path = path
        self.connection = connection
        self.capabilityTask = capabilityTask
    }

    func invalidate() {}

    func enumerateItems(for observer: NSFileProviderEnumerationObserver,
                        startingAt page: NSFileProviderPage) {
        guard let path else {
            observer.didEnumerate([])
            observer.finishEnumerating(upTo: nil)
            return
        }
        let cursor: String?
        do { cursor = try ProviderEnumerationState.cursor(for: page) }
        catch {
            observer.finishEnumeratingWithError(NSError(domain: NSFileProviderErrorDomain, code: -1002))
            return
        }
        let client = DriveBridge(connection: connection)
        Task {
            do {
                async let listed = client.list(path: path, cursor: cursor)
                let capabilities = try await capabilityTask.value
                let result = try await listed
                let items = try result.entries.map { entry -> FileProviderItem in
                    let childPath = path == "/" ? "/\(entry.name)" : "\(path)/\(entry.name)"
                    let item = FileProviderItem(path: childPath, entry: entry, capabilities: capabilities)
                    lock.lock()
                    snapshot[item.itemIdentifier.rawValue] = item
                    lock.unlock()
                    return item
                }
                observer.didEnumerate(items)
                let next = ProviderEnumerationState.page(after: result.nextCursor)
                if next == nil { updateAnchor() }
                observer.finishEnumerating(upTo: next)
            } catch {
                observer.finishEnumeratingWithError(providerError(error))
            }
        }
    }

    func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
        lock.lock()
        let value = anchor
        lock.unlock()
        completionHandler(NSFileProviderSyncAnchor(rawValue: value))
    }

    func enumerateChanges(for observer: NSFileProviderChangeObserver,
                          from anchor: NSFileProviderSyncAnchor) {
        lock.lock()
        let knownAnchor = self.anchor
        lock.unlock()
        guard ProviderEnumerationState.isCurrent(anchor, expected: knownAnchor) else {
            observer.finishEnumeratingWithError(
                NSError(domain: NSFileProviderErrorDomain, code: -1002)
            )
            return
        }
        guard let path else {
            updateAnchor()
            currentSyncAnchor { next in
                observer.finishEnumeratingChanges(
                    upTo: next ?? NSFileProviderSyncAnchor(rawValue: ProviderEnumerationState.initialSyncAnchor),
                    moreComing: false
                )
            }
            return
        }
        let client = DriveBridge(connection: connection)
        Task {
            do {
                let capabilities = try await capabilityTask.value
                var cursor: String?
                var current: [String: FileProviderItem] = [:]
                repeat {
                    let page = try await client.list(path: path, cursor: cursor)
                    for entry in page.entries {
                        let childPath = path == "/" ? "/\(entry.name)" : "\(path)/\(entry.name)"
                        let item = FileProviderItem(path: childPath, entry: entry, capabilities: capabilities)
                        current[item.itemIdentifier.rawValue] = item
                    }
                    cursor = page.nextCursor
                } while cursor != nil

                let old = lock.withLock {
                    let value = snapshot
                    snapshot = current
                    return value
                }
                let updates = current.compactMap { key, value in
                    old[key]?.itemVersion == value.itemVersion ? nil : value
                }
                let removed = old.keys.filter { current[$0] == nil }
                    .map(NSFileProviderItemIdentifier.init(rawValue:))
                if !updates.isEmpty { observer.didUpdate(updates) }
                if !removed.isEmpty { observer.didDeleteItems(withIdentifiers: removed) }
                updateAnchor()
                currentSyncAnchor { anchor in
                    observer.finishEnumeratingChanges(
                        upTo: anchor ?? NSFileProviderSyncAnchor(rawValue: ProviderEnumerationState.initialSyncAnchor),
                        moreComing: false
                    )
                }
            } catch {
                observer.finishEnumeratingWithError(providerError(error))
            }
        }
    }

    private func updateAnchor() {
        lock.lock()
        anchor = Data(UUID().uuidString.utf8)
        lock.unlock()
    }
}

private extension NSFileProviderItemVersion {
    var contentVersionString: String? {
        guard let value = String(data: contentVersion, encoding: .utf8), !value.isEmpty,
              value.utf8.count <= 512 else { return nil }
        return value
    }
}

private func providerError(_ error: Error) -> NSError {
    if let error = error as? BridgeClientError {
        switch error {
        case .remote("ENOENT"):
            return NSError(domain: NSFileProviderErrorDomain, code: -1005)
        case .remote("EEXIST"):
            return NSError(domain: NSFileProviderErrorDomain, code: -1001)
        case .remote("ENOTEMPTY"):
            return NSError(domain: NSFileProviderErrorDomain, code: -1007)
        case .remote("ENOSPC"), .remote("EDQUOT"):
            return NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError)
        case .remote("EFBIG"):
            return NSError(domain: NSPOSIXErrorDomain, code: Int(EFBIG))
        case .rejected:
            return NSError(domain: NSFileProviderErrorDomain, code: -1000)
        case .unavailable, .remote("EHOSTUNREACH"), .remote("ETIMEDOUT"):
            return NSError(domain: NSFileProviderErrorDomain, code: -1004)
        case .remote("EACCES"):
            return NSError(domain: NSCocoaErrorDomain, code: NSFileReadNoPermissionError)
        case .remoteFailure(let failure):
            var userInfo: [String: Any] = [:]
            if let recoveryPath = failure.recoveryPath {
                userInfo[NSLocalizedDescriptionKey] =
                    "The change conflicted with a remote update. Your staged copy is preserved at \(recoveryPath)."
                userInfo["AgentDriveRecoveryPath"] = recoveryPath
            }
            if let currentVersionId = failure.currentVersionId {
                userInfo["AgentDriveCurrentVersionId"] = currentVersionId
            }
            switch failure.errno {
            case "ENOENT":
                return NSError(domain: NSFileProviderErrorDomain, code: -1005, userInfo: userInfo)
            case "EEXIST":
                return NSError(domain: NSFileProviderErrorDomain, code: -1001, userInfo: userInfo)
            case "ENOTEMPTY":
                return NSError(domain: NSFileProviderErrorDomain, code: -1007, userInfo: userInfo)
            case "ENOSPC", "EDQUOT":
                return NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError, userInfo: userInfo)
            case "EFBIG":
                return NSError(domain: NSPOSIXErrorDomain, code: Int(EFBIG), userInfo: userInfo)
            case "ESTALE":
                return NSError(domain: NSFileProviderErrorDomain, code: -2009, userInfo: userInfo)
            case "EACCES", "EPERM":
                return NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError, userInfo: userInfo)
            default:
                return NSError(domain: NSCocoaErrorDomain, code: NSFileWriteUnknownError, userInfo: userInfo)
            }
        default:
            return NSError(domain: NSCocoaErrorDomain, code: NSFileReadUnknownError)
        }
    }
    return NSError(domain: NSCocoaErrorDomain, code: NSFileReadUnknownError)
}
