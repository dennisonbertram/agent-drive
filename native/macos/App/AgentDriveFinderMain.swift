import Darwin
import Dispatch
import FileProvider
import Foundation

@main
enum AgentDriveFinder {
    static func main() async {
        do {
            guard CommandLine.arguments.dropFirst().first == "connect" else {
                throw BootstrapError.invalidCommand
            }
            let input = try readOneLine(limit: 4_096)
            let request = try JSONDecoder().decode(ConnectInput.self, from: input)
            let connection = try MountConnection(
                driveId: request.driveId,
                port: request.port,
                token: request.token
            )
            let sessionId = UUID().uuidString.lowercased()
            let descriptor = try MountDescriptor(connection: connection, sessionId: sessionId)
            let store = try ConnectionStore(directory: appGroupDirectory())
            let session = try store.startSession(descriptor)

            var registration: DomainRegistration?
            do {
                let registered = try await registerDomain(
                    driveId: connection.driveId,
                    temporaryDomain: request.temporaryDomain == true,
                    session: session
                )
                registration = registered
                let root = try await userVisibleURL(manager: registered.manager)
                guard root.path.utf8.count <= 4_096 else { throw BootstrapError.invalidMountPath }
                let output = try JSONEncoder().encode(
                    ConnectOutput(path: root.path, protocolVersion: 2)
                )
                await waitForTermination {
                    FileHandle.standardOutput.write(output)
                    FileHandle.standardOutput.write(Data([0x0a]))
                }
                try await finishDomain(registered, temporaryDomain: request.temporaryDomain, session: session)
                registration = nil
                try? session.close()
            } catch {
                if let registration {
                    await finishDomainBestEffort(
                        registration, temporaryDomain: request.temporaryDomain, session: session
                    )
                }
                try? session.close()
                throw error
            }
        } catch {
            FileHandle.standardError.write(Data("Agent Drive Finder could not connect (\(safeErrorDiagnostic(error))).\n".utf8))
            exit(1)
        }
    }

    private static func registerDomain(
        driveId: String,
        temporaryDomain: Bool,
        session: MountSession
    ) async throws -> DomainRegistration {
        let identifier = NSFileProviderDomainIdentifier("agent-drive-\(driveId)")
        let proposed = NSFileProviderDomain(
            identifier: identifier,
            displayName: "Agent Drive \(driveId.prefix(8))"
        )
        let domains = try await availableDomains()
        let selected: NSFileProviderDomain
        let createdByCurrentSession: Bool
        if let existing = domains.first(where: { $0.identifier == identifier }) {
            guard !temporaryDomain else { throw BootstrapError.temporaryDomainAlreadyExists }
            guard existing.userEnabled else { throw BootstrapError.domainDisabled }
            if existing.isDisconnected {
                guard let existingManager = NSFileProviderManager(for: existing) else {
                    throw BootstrapError.domainUnavailable
                }
                try await existingManager.reconnect()
                selected = existing
                createdByCurrentSession = false
            } else {
                selected = existing
                createdByCurrentSession = false
            }
        } else {
            try await NSFileProviderManager.add(proposed)
            selected = proposed
            createdByCurrentSession = true
        }
        guard let manager = NSFileProviderManager(for: selected) else {
            if temporaryDomain && createdByCurrentSession && session.isCurrentOwner {
                _ = try await NSFileProviderManager.remove(
                    selected, mode: .preserveDirtyUserData
                )
            }
            throw BootstrapError.domainUnavailable
        }
        return DomainRegistration(domain: selected, manager: manager, createdByCurrentSession: createdByCurrentSession)
    }

    private static func finishDomain(
        _ registration: DomainRegistration,
        temporaryDomain: Bool?,
        session: MountSession
    ) async throws {
        if temporaryDomain == true {
            guard ProviderDomainCleanupPolicy.shouldRemove(
                temporaryDomain: temporaryDomain,
                createdByCurrentSession: registration.createdByCurrentSession,
                ownsSession: session.isCurrentOwner
            ) else { return }
            _ = try await NSFileProviderManager.remove(
                registration.domain, mode: .preserveDirtyUserData
            )
        } else if let manager = NSFileProviderManager(for: registration.domain) {
            try? await manager.disconnect(reason: "Agent Drive mount stopped.", options: [])
        }
    }

    private static func finishDomainBestEffort(
        _ registration: DomainRegistration,
        temporaryDomain: Bool?,
        session: MountSession
    ) async {
        do {
            try await finishDomain(registration, temporaryDomain: temporaryDomain, session: session)
        } catch {
            // The diagnostic is intentionally limited to an allow-listed category.
            FileHandle.standardError.write(Data(
                "Agent Drive Finder domain cleanup failed (\(safeErrorDiagnostic(error))).\n".utf8
            ))
        }
    }

    private static func availableDomains() async throws -> [NSFileProviderDomain] {
        try await withCheckedThrowingContinuation { continuation in
            NSFileProviderManager.getDomainsWithCompletionHandler { domains, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: domains ?? []) }
            }
        }
    }

    private static func userVisibleURL(manager: NSFileProviderManager) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            manager.getUserVisibleURL(for: .rootContainer) { url, error in
                if let error { continuation.resume(throwing: error) }
                else if let url { continuation.resume(returning: url) }
                else { continuation.resume(throwing: BootstrapError.domainUnavailable) }
            }
        }
    }

    private static func appGroupDirectory() throws -> URL {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "AgentDriveAppGroup") as? String,
              !group.contains("$("),
              let base = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: group
              )
        else { throw BootstrapError.appGroupUnavailable }
        return base.appendingPathComponent("AgentDriveFinder", isDirectory: true)
    }

    private static func readOneLine(limit: Int) throws -> Data {
        var result = Data()
        while result.count < limit {
            let byte = try FileHandle.standardInput.read(upToCount: 1) ?? Data()
            guard let value = byte.first else { break }
            if value == 0x0a { return result }
            result.append(value)
        }
        guard result.count < limit else { throw BootstrapError.invalidInput }
        throw BootstrapError.invalidInput
    }

    private static func waitForTermination(reportReady: () -> Void) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let waiter = SignalWaiter(continuation)
            // The signal sources retain their handler for the lifetime of the
            // wait; the handler retains the waiter until it resumes this task.
            waiter.start(reportReady: reportReady)
        }
    }
}

private func safeErrorDiagnostic(_ error: Error) -> String {
    if let error = error as? BootstrapError {
        switch error {
        case .invalidCommand: return "unsupported-command [bootstrap:1]"
        case .invalidInput: return "invalid-startup-input [bootstrap:2]"
        case .invalidMountPath: return "invalid-mount-path [bootstrap:3]"
        case .appGroupUnavailable: return "shared-container-unavailable [bootstrap:4]"
        case .domainDisabled: return "file-provider-domain-disabled-in-system-settings [bootstrap:5]"
        case .domainUnavailable: return "file-provider-registration-failed [bootstrap:6]"
        case .temporaryDomainAlreadyExists: return "temporary-domain-already-exists [bootstrap:7]"
        }
    }
    if let error = error as? BridgeClientError {
        switch error {
        case .rejected: return "drive-already-mounted-or-shared-state-rejected [bridge:rejected]"
        case .invalidConnection: return "invalid-startup-connection [bridge:invalid-connection]"
        case .invalidPath: return "invalid-mount-path [bridge:invalid-path]"
        case .unavailable: return "file-provider-service-unavailable [bridge:unavailable]"
        case .invalidRead: return "connection-failed [bridge:invalid-read]"
        case .malformedResponse: return "connection-failed [bridge:malformed-response]"
        case .remote: return "connection-failed [bridge:remote-error]"
        case .remoteFailure: return "connection-failed [bridge:remote-error]"
        }
    }
    let system = error as NSError
    let domain: String
    switch system.domain {
    case NSFileProviderErrorDomain: domain = "FileProviderErrorDomain"
    case NSCocoaErrorDomain: domain = "CocoaErrorDomain"
    case NSPOSIXErrorDomain: domain = "POSIXErrorDomain"
    case NSOSStatusErrorDomain: domain = "OSStatusErrorDomain"
    default: domain = "SystemErrorDomain"
    }
    if system.domain == NSFileProviderErrorDomain {
        switch system.code {
        case -1000: return "file-provider-not-authenticated [\(domain):\(system.code)]"
        case -1004: return "file-provider-server-unreachable [\(domain):\(system.code)]"
        case -2001, -2002, -2003, -2004, -2014:
            return "file-provider-extension-unavailable [\(domain):\(system.code)]"
        default: return "file-provider-registration-failed [\(domain):\(system.code)]"
        }
    }
    return "file-provider-registration-failed [\(domain):\(system.code)]"
}

private struct ConnectInput: Decodable {
    let driveId: String
    let port: Int
    let token: String
    let temporaryDomain: Bool?
}

private struct DomainRegistration {
    let domain: NSFileProviderDomain
    let manager: NSFileProviderManager
    let createdByCurrentSession: Bool
}

private struct ConnectOutput: Encodable {
    let path: String
    let protocolVersion: Int
}

private enum BootstrapError: Error {
    case invalidCommand
    case invalidInput
    case invalidMountPath
    case appGroupUnavailable
    case domainDisabled
    case domainUnavailable
    case temporaryDomainAlreadyExists
}

private final class SignalWaiter: @unchecked Sendable {
    private let continuation: CheckedContinuation<Void, Never>
    private let lock = NSLock()
    private var sources: [DispatchSourceSignal] = []
    private var inputSource: DispatchSourceRead?
    private var didStart = false
    private var didFinish = false

    init(_ continuation: CheckedContinuation<Void, Never>) {
        self.continuation = continuation
    }

    func start(reportReady: () -> Void) {
        lock.lock()
        guard !didStart, !didFinish else {
            lock.unlock()
            return
        }
        didStart = true
        for signalNumber in [SIGTERM, SIGINT] {
            Darwin.signal(signalNumber, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
            source.setEventHandler { [self] in finish() }
            sources.append(source)
            source.resume()
        }
        let inputSource = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
        inputSource.setEventHandler { [self] in finish() }
        self.inputSource = inputSource
        inputSource.resume()
        reportReady()
        lock.unlock()
    }

    private func finish() {
        lock.lock()
        guard !didFinish else {
            lock.unlock()
            return
        }
        didFinish = true
        let signalSources = sources
        let stdinSource = inputSource
        sources.removeAll()
        inputSource = nil
        lock.unlock()
        for source in signalSources { source.cancel() }
        stdinSource?.cancel()
        continuation.resume()
    }
}
