import Foundation
import XCTest
@testable import AgentDriveFinderCore

final class ConnectionStoreTests: XCTestCase {
    func testActiveSessionRejectsSecondMountAndCrashRecoveryPreservesOwnership() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ad-finder-test-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try ConnectionStore(directory: directory)
        let connection = try MountConnection(
            driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40",
            port: 43210,
            token: "per-run-capability"
        )
        let firstDescriptor = try MountDescriptor(connection: connection, sessionId: "11111111-1111-4111-8111-111111111111")
        let second = try MountDescriptor(connection: connection, sessionId: "22222222-2222-4222-8222-222222222222")

        let first = try store.startSession(firstDescriptor)
        XCTAssertTrue(first.isCurrentOwner)

        let directoryAttributes = try FileManager.default.attributesOfItem(atPath: directory.path)
        let descriptorURL = directory.appendingPathComponent("connection-\(connection.driveId).json")
        let descriptorAttributes = try FileManager.default.attributesOfItem(atPath: descriptorURL.path)
        let raw = try String(contentsOf: descriptorURL, encoding: .utf8)
        XCTAssertEqual((directoryAttributes[.posixPermissions] as? NSNumber)?.intValue, 0o700)
        XCTAssertEqual((descriptorAttributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        XCTAssertTrue(raw.contains("per-run-capability"))
        XCTAssertFalse(raw.contains("apiKey"))
        XCTAssertFalse(raw.contains("driveKey"))
        XCTAssertEqual(try store.load(driveId: connection.driveId), firstDescriptor)
        XCTAssertThrowsError(try store.startSession(second), "A second session must not supersede the owner.")

        try first.close()
        XCTAssertFalse(first.isCurrentOwner)
        XCTAssertThrowsError(try store.load(driveId: connection.driveId))

        // A descriptor can survive a process crash after the kernel releases its lock.
        let stale = try MountDescriptor(connection: connection, sessionId: "a5069575-7632-4d15-bcbc-9bc11a5df2d3")
        let stalePath = directory.appendingPathComponent("connection-\(connection.driveId).json")
        try JSONEncoder().encode(stale).write(to: stalePath)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stalePath.path)
        let current = try store.startSession(second)
        XCTAssertEqual(try store.load(driveId: connection.driveId), second)
        XCTAssertTrue(current.isCurrentOwner)
        XCTAssertFalse(first.isCurrentOwner)

        // Delayed cleanup from the old session must never remove a replacement.
        try first.close()
        XCTAssertEqual(try store.load(driveId: connection.driveId), second)
        try current.close()
        XCTAssertThrowsError(try store.load(driveId: connection.driveId))
    }
}
