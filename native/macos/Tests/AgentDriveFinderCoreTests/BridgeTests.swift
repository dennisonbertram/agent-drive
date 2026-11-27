import Foundation
import XCTest
@testable import AgentDriveFinderCore

final class BridgeTests: XCTestCase {
    func testBridgeEntryDecodesOptionalPerEntryReadOnly() throws {
        let decoder = JSONDecoder()
        let locked = try decoder.decode(
            BridgeEntry.self,
            from: Data(#"{"name":"locked.txt","kind":"file","size":3,"mtimeMs":4,"versionId":"v1","readOnly":true}"#.utf8)
        )
        let legacy = try decoder.decode(
            BridgeEntry.self,
            from: Data(#"{"name":"normal.txt","kind":"file","size":3,"mtimeMs":4,"versionId":"v1"}"#.utf8)
        )

        XCTAssertEqual(locked.readOnly, true)
        XCTAssertNil(legacy.readOnly)
    }

    func testLegacyBridgeDoesNotAdvertiseProducerCompletion() {
        let legacy = MountCapabilities(
            readOnly: false,
            write: true,
            delete: false,
            writePaths: [],
            maxReadBytes: 1_048_576,
            maxWriteBytes: 1_048_576,
            ops: ["openWrite", "write", "truncate", "flush", "flushStatus", "release"]
        )

        XCTAssertFalse(legacy.supportsIncompleteWrite)
    }

    func testConnectionValidatesDrivePortAndCapabilityWithoutLoggingTheCapability() throws {
        let connection = try MountConnection(
            driveId: "D1ED8A9E-82E0-4F68-900E-50737A5A6B40",
            port: 43210,
            token: "synthetic-local-capability"
        )

        XCTAssertEqual(connection.driveId, "d1ed8a9e-82e0-4f68-900e-50737a5a6b40")
        XCTAssertFalse(String(describing: connection).contains(connection.token))
        XCTAssertThrowsError(try MountConnection(driveId: "bad", port: 43210, token: "x"))
        XCTAssertThrowsError(try MountConnection(driveId: connection.driveId, port: 0, token: "x"))
        XCTAssertThrowsError(try MountConnection(driveId: connection.driveId, port: 43210, token: ""))
    }

    func testItemIdentifiersRoundTripCanonicalAbsolutePaths() throws {
        XCTAssertEqual(try ItemPath(identifier: "root").path, "/")
        XCTAssertEqual(try ItemPath(identifier: ItemPath.identifier(for: "/notes/a.txt")).path, "/notes/a.txt")
        XCTAssertThrowsError(try ItemPath(identifier: ItemPath.identifier(for: "/notes/../secret")))
        XCTAssertThrowsError(try ItemPath(identifier: ItemPath.identifier(for: "relative")))
    }

    func testBridgeRequestsKeepCapabilityInAuthorizationHeaderAndCapReads() async throws {
        let protocolStub = MockURLProtocol.self
        protocolStub.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:43210/rpc")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-local-capability")
            let body = try XCTUnwrap(MockURLProtocol.bodyData(request))
            XCTAssertFalse(String(decoding: body, as: UTF8.self).contains("synthetic-local-capability"))
            let sent = try JSONSerialization.jsonObject(with: body) as! [String: Any]
            XCTAssertEqual(sent["op"] as? String, "read")
            XCTAssertEqual(sent["path"] as? String, "/notes/a.txt")
            XCTAssertEqual(sent["versionId"] as? String, "version-1")
            XCTAssertEqual(sent["offset"] as? Int, 4)
            XCTAssertEqual(sent["size"] as? Int, 8)
            let id = try XCTUnwrap(sent["id"] as? String)
            return try MockURLProtocol.response(json: ["id": id, "ok": true, "data": "AQID"])
        }

        let session = MockURLProtocol.makeSession()
        let connection = try MountConnection(
            driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40",
            port: 43210,
            token: "synthetic-local-capability"
        )
        let client = DriveBridge(connection: connection, session: session)

        let bytes = try await client.read(path: "/notes/a.txt", versionId: "version-1", offset: 4, size: 8)
        XCTAssertEqual(bytes, Data([1, 2, 3]))
        await XCTAssertThrowsErrorAsync {
            _ = try await client.read(path: "/notes/a.txt", versionId: "version-1", offset: 0, size: 1_048_577)
        }
    }

    func testListAndStatDecodeAndRejectMismatchedResponseIds() async throws {
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            if sent["op"] as? String == "list" {
                return try MockURLProtocol.response(json: [
                    "id": id,
                    "ok": true,
                    "entries": [["name": "a.txt", "kind": "file", "size": 7, "mtimeMs": 1_700_000_000_000, "versionId": "v1"]],
                    "nextCursor": NSNull(),
                ])
            }
            return try MockURLProtocol.response(json: [
                "id": "wrong-id",
                "ok": true,
                "entry": ["name": "a.txt", "kind": "file", "size": 7, "mtimeMs": 1_700_000_000_000, "versionId": "v1"],
            ])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )

        let page = try await client.list(path: "/")
        XCTAssertEqual(page.entries.first?.versionId, "v1")
        XCTAssertNil(page.nextCursor)
        await XCTAssertThrowsErrorAsync { _ = try await client.stat(path: "/a.txt") }
    }

    func testCapabilityNegotiationEnforcesPathBoundariesAndDeleteScope() async throws {
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            XCTAssertEqual(sent["op"] as? String, "capabilities")
            return try MockURLProtocol.response(json: [
                "id": id,
                "ok": true,
                "capabilities": [
                    "readOnly": false,
                    "write": true,
                    "delete": true,
                    "writePaths": ["/work"],
                    "maxReadBytes": 1_048_576,
                    "maxWriteBytes": 1_048_576,
                    "ops": ["list", "stat", "read", "openWrite", "write", "truncate", "finalizeWrite", "flushStatus", "closeWrite", "mkdir", "unlink", "rmdir", "rename"],
                ],
            ])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )
        let capabilities = try await client.capabilities()
        XCTAssertTrue(capabilities.allowsWrite("/work/notes.txt"))
        XCTAssertFalse(capabilities.allowsWrite("/worker/notes.txt"))
        XCTAssertTrue(capabilities.allowsDelete("/work/notes.txt"))
        XCTAssertTrue(capabilities.allowsCreatingChildren(of: "/"))
        XCTAssertTrue(capabilities.allowsCreatingChildren(of: "/work"))
        XCTAssertTrue(capabilities.allowsCreatingChildren(of: "/work/sub"))
        XCTAssertFalse(capabilities.allowsCreatingChildren(of: "/outside"))
        XCTAssertTrue(capabilities.supportsIncompleteWrite)
    }

    func testDefaultRenameOperationIdsAreFreshPerLogicalCall() async throws {
        let operationIds = LockedList<String>()
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            operationIds.append(try XCTUnwrap(sent["operationId"] as? String))
            return try MockURLProtocol.response(json: [
                "id": id,
                "ok": true,
                "entry": ["id": "11111111-1111-4111-8111-111111111111", "path": "/work/new.txt", "versionId": "22222222-2222-4222-8222-222222222222"],
            ])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )
        for _ in 0..<2 {
            _ = try await client.rename(
                path: "/work/old.txt",
                destinationPath: "/work/new.txt",
                ifSourceVersionId: "33333333-3333-4333-8333-333333333333"
            )
        }
        XCTAssertEqual(operationIds.values.count, 2)
        XCTAssertNotEqual(operationIds.values[0], operationIds.values[1])
    }

    func testStatCanRequestMetadataForPinnedHistoricalVersion() async throws {
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            XCTAssertEqual(sent["op"] as? String, "stat")
            XCTAssertEqual(sent["path"] as? String, "/work/file.txt")
            XCTAssertEqual(sent["versionId"] as? String, "33333333-3333-4333-8333-333333333333")
            return try MockURLProtocol.response(json: [
                "id": id,
                "ok": true,
                "entry": ["name": "file.txt", "kind": "file", "size": 31, "mtimeMs": 10, "versionId": "33333333-3333-4333-8333-333333333333"],
            ])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )
        let entry = try await client.stat(
            path: "/work/file.txt",
            versionId: "33333333-3333-4333-8333-333333333333"
        )
        XCTAssertEqual(entry.size, 31)
        XCTAssertEqual(entry.versionId, "33333333-3333-4333-8333-333333333333")
    }

    func testWriteProtocolUsesExplicitCreateOnlyNullAndPreservesConflictRecoveryDetails() async throws {
        let operations = LockedList<String>()
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            let op = try XCTUnwrap(sent["op"] as? String)
            operations.append(op)
            switch op {
            case "openWrite":
                XCTAssertEqual(sent["path"] as? String, "/work/new.txt")
                XCTAssertTrue(sent["baseVersionId"] is NSNull)
                XCTAssertEqual(sent["truncateOnOpen"] as? Bool, true)
                XCTAssertEqual(sent["incomplete"] as? Bool, true)
                return try MockURLProtocol.response(json: [
                    "id": id, "ok": true, "handleId": "stage-1",
                    "recoveryPath": "/tmp/agent-drive-recovery/new.txt", "size": 0,
                ])
            case "write":
                XCTAssertEqual(sent["handleId"] as? String, "stage-1")
                XCTAssertEqual(sent["offset"] as? Int, 0)
                XCTAssertEqual(sent["data"] as? String, "AQID")
                return try MockURLProtocol.response(json: ["id": id, "ok": true, "bytesWritten": 3])
            case "finalizeWrite":
                return try MockURLProtocol.response(json: [
                    "id": id, "ok": false, "errno": "ESTALE",
                    "recoveryPath": "/tmp/agent-drive-recovery/new.txt",
                    "currentVersionId": "remote-v2",
                ])
            default:
                throw BridgeClientError.malformedResponse
            }
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )
        let handle = try await client.openWrite(
            path: "/work/new.txt", baseVersionId: nil, truncateOnOpen: true, incomplete: true
        )
        XCTAssertEqual(handle.handleId, "stage-1")
        let bytesWritten = try await client.write(handleId: handle.handleId, offset: 0, data: Data([1, 2, 3]))
        XCTAssertEqual(bytesWritten, 3)
        do {
            _ = try await client.finalizeWrite(handleId: handle.handleId)
            XCTFail("Expected stale base version to preserve recovery details.")
        } catch BridgeClientError.remoteFailure(let failure) {
            XCTAssertEqual(failure.errno, "ESTALE")
            XCTAssertEqual(failure.recoveryPath, "/tmp/agent-drive-recovery/new.txt")
            XCTAssertEqual(failure.currentVersionId, "remote-v2")
            XCTAssertFalse(failure.outcomeIsUnknown)
        }
        XCTAssertEqual(operations.values, ["openWrite", "write", "finalizeWrite"])
    }

    func testDirectoryDeleteAndGuardedRenameUseExactMutationFields() async throws {
        let operations = LockedList<String>()
        let itemID = "22222222-2222-4222-8222-222222222222"
        let versionID = "33333333-3333-4333-8333-333333333333"
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            let op = try XCTUnwrap(sent["op"] as? String)
            operations.append(op)
            switch op {
            case "mkdir":
                XCTAssertEqual(sent["path"] as? String, "/work/new")
            case "unlink":
                XCTAssertEqual(sent["path"] as? String, "/work/old.txt")
                XCTAssertEqual(sent["ifVersionId"] as? String, versionID)
                XCTAssertNil(sent["versionId"])
            case "rename":
                XCTAssertEqual(sent["path"] as? String, "/work/old.txt")
                XCTAssertEqual(sent["destinationPath"] as? String, "/work/new.txt")
                XCTAssertEqual(sent["ifSourceVersionId"] as? String, versionID)
                XCTAssertTrue(sent["ifDestinationVersionId"] is NSNull)
                XCTAssertEqual(sent["operationId"] as? String, "44444444-4444-4444-8444-444444444444")
            default:
                XCTFail("Unexpected RPC operation \(op)")
            }
            return try MockURLProtocol.response(json: [
                "id": id,
                "ok": true,
                "entry": ["id": itemID, "path": "/work/new.txt", "versionId": versionID],
            ])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )
        try await client.mkdir(path: "/work/new")
        try await client.unlink(path: "/work/old.txt", ifVersionId: versionID)
        let rename = try await client.rename(
            path: "/work/old.txt",
            destinationPath: "/work/new.txt",
            ifSourceVersionId: versionID,
            operationId: "44444444-4444-4444-8444-444444444444"
        )
        XCTAssertEqual(rename.id, itemID)
        XCTAssertEqual(rename.path, "/work/new.txt")
        XCTAssertEqual(rename.versionId, versionID)
        XCTAssertEqual(operations.values, ["mkdir", "unlink", "rename"])
    }

    func testFlushDecodesCanonicalNestedCommittedVersion() async throws {
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            XCTAssertEqual(sent["op"] as? String, "finalizeWrite")
            XCTAssertNotNil(UUID(uuidString: sent["operationId"] as? String ?? ""))
            return try MockURLProtocol.response(json: [
                "id": id,
                "ok": true,
                "version": ["id": "22222222-2222-4222-8222-222222222222", "path": "/work/new.txt"],
            ])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )
        let result = try await client.finalizeWrite(handleId: "interop-stage")
        XCTAssertEqual(result.version, "22222222-2222-4222-8222-222222222222")
    }

    func testFlushRetriesCapacityRejectionWithTheSameOperationId() async throws {
        let operationIds = LockedList<String>()
        let attempts = LockedList<Int>()
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            XCTAssertEqual(sent["op"] as? String, "finalizeWrite")
            let operationId = try XCTUnwrap(sent["operationId"] as? String)
            operationIds.append(operationId)
            let attempt = attempts.values.count + 1
            attempts.append(attempt)
            if attempt == 1 {
                return try MockURLProtocol.response(json: [
                    "id": id,
                    "ok": false,
                    "errno": "EBUSY",
                    "mutationOutcome": "notSubmitted",
                ])
            }
            return try MockURLProtocol.response(json: [
                "id": id,
                "ok": true,
                "version": ["id": "22222222-2222-4222-8222-222222222222", "path": "/work/retry.txt"],
            ])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )

        let result = try await client.finalizeWrite(handleId: "busy-stage")

        XCTAssertEqual(result.version, "22222222-2222-4222-8222-222222222222")
        XCTAssertEqual(operationIds.values.count, 2)
        XCTAssertEqual(operationIds.values[0], operationIds.values[1])
    }

    func testCloseWriteRequestsNoFlushCleanupForTheStagedHandle() async throws {
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            XCTAssertEqual(sent["op"] as? String, "closeWrite")
            XCTAssertEqual(sent["handleId"] as? String, "stage-to-preserve")
            XCTAssertNil(sent["operationId"])
            return try MockURLProtocol.response(json: ["id": id, "ok": true, "recoveryPath": "/tmp/recovery.txt"])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )

        try await client.closeWrite(handleId: "stage-to-preserve")
    }

    func testCloseWriteRetriesAnUncertainResponseForTheSameHandle() async throws {
        let attempts = LockedList<Int>()
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            XCTAssertEqual(sent["op"] as? String, "closeWrite")
            XCTAssertEqual(sent["handleId"] as? String, "stage-to-preserve")
            attempts.append(attempts.values.count + 1)
            if attempts.values.count == 1 { throw URLError(.timedOut) }
            return try MockURLProtocol.response(json: ["id": id, "ok": true])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )

        try await client.closeWrite(handleId: "stage-to-preserve")

        XCTAssertEqual(attempts.values, [1, 2])
    }

    func testWriteCleanupOnlyTreatsExplicitNotSubmittedAsSafeToClose() {
        let notSubmitted = BridgeClientError.remoteFailure(RPCFailure(
            errno: "EBUSY",
            mutationOutcome: "notSubmitted"
        ))
        let unknown = BridgeClientError.remoteFailure(RPCFailure(
            errno: "ETIMEDOUT",
            mutationOutcome: "unknown"
        ))
        let terminal = BridgeClientError.remoteFailure(RPCFailure(errno: "ESTALE"))

        XCTAssertTrue(notSubmitted.confirmsNotSubmitted)
        XCTAssertFalse(unknown.confirmsNotSubmitted)
        XCTAssertFalse(terminal.confirmsNotSubmitted)
    }

    func testFlushPollsTheSameBoundedOperationUntilItReturnsTheCommittedVersion() async throws {
        let operations = LockedList<String>()
        let operationId = LockedList<String>()
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            let op = try XCTUnwrap(sent["op"] as? String)
            operations.append(op)
            if op == "finalizeWrite" {
                XCTAssertEqual(sent["handleId"] as? String, "slow-stage")
                operationId.append(try XCTUnwrap(sent["operationId"] as? String))
                return try MockURLProtocol.response(json: [
                    "id": id, "ok": true, "pending": true,
                    "operationId": operationId.values[0],
                ])
            }
            XCTAssertEqual(op, "flushStatus")
            XCTAssertEqual(sent["handleId"] as? String, "slow-stage")
            XCTAssertEqual(sent["operationId"] as? String, operationId.values.first)
            return try MockURLProtocol.response(json: [
                "id": id, "ok": true,
                "version": ["id": "22222222-2222-4222-8222-222222222222", "path": "/work/large.bin"],
            ])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )

        let result = try await client.finalizeWrite(handleId: "slow-stage")
        XCTAssertEqual(result.version, "22222222-2222-4222-8222-222222222222")
        XCTAssertEqual(operations.values, ["finalizeWrite", "flushStatus"])
    }

    func testFlushPreservesUnknownOutcomeWhenStatusCannotBeReconciled() async throws {
        let operationId = LockedList<String>()
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            if sent["op"] as? String == "finalizeWrite" {
                operationId.append(try XCTUnwrap(sent["operationId"] as? String))
                return try MockURLProtocol.response(json: [
                    "id": id, "ok": true, "pending": true,
                    "operationId": operationId.values[0],
                ])
            }
            return try MockURLProtocol.response(json: [
                "id": id, "ok": false, "errno": "ETIMEDOUT", "mutationOutcome": "unknown",
            ])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )

        do {
            _ = try await client.finalizeWrite(handleId: "slow-stage")
            XCTFail("Expected the unknown commit outcome to be preserved")
        } catch let BridgeClientError.remoteFailure(failure) {
            XCTAssertEqual(failure.errno, "ETIMEDOUT")
            XCTAssertEqual(failure.mutationOutcome, "unknown")
            XCTAssertEqual(failure.operationId, operationId.values.first)
            XCTAssertTrue(failure.outcomeIsUnknown)
        }
    }

    func testFlushRetriesAStatusConnectionFailureWithoutStartingAnotherOperation() async throws {
        let operationId = LockedList<String>()
        let operations = LockedList<String>()
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            let op = try XCTUnwrap(sent["op"] as? String)
            operations.append(op)
            if op == "finalizeWrite" {
                let newId = try XCTUnwrap(sent["operationId"] as? String)
                operationId.append(newId)
                return try MockURLProtocol.response(json: [
                    "id": id, "ok": true, "pending": true, "operationId": newId,
                ])
            }
            XCTAssertEqual(sent["operationId"] as? String, operationId.values.first)
            if operations.values.filter({ $0 == "flushStatus" }).count == 1 {
                throw URLError(.timedOut)
            }
            return try MockURLProtocol.response(json: [
                "id": id, "ok": true,
                "version": ["id": "22222222-2222-4222-8222-222222222222", "path": "/work/large.bin"],
            ])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )

        let result = try await client.finalizeWrite(handleId: "slow-stage")
        XCTAssertEqual(result.version, "22222222-2222-4222-8222-222222222222")
        XCTAssertEqual(operations.values, ["finalizeWrite", "flushStatus", "flushStatus"])
    }

    func testFlushRetriesAUncertainStartUsingTheSameOperationId() async throws {
        let operationIds = LockedList<String>()
        let flushCalls = LockedList<Int>()
        MockURLProtocol.handler = { request in
            let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(MockURLProtocol.bodyData(request))) as! [String: Any]
            let id = try XCTUnwrap(sent["id"] as? String)
            let op = try XCTUnwrap(sent["op"] as? String)
            if op == "finalizeWrite" {
                let operationId = try XCTUnwrap(sent["operationId"] as? String)
                operationIds.append(operationId)
                let call = flushCalls.values.count + 1
                flushCalls.append(call)
                if call == 1 { throw URLError(.timedOut) }
                return try MockURLProtocol.response(json: [
                    "id": id, "ok": true, "pending": true, "operationId": operationId,
                ])
            }
            XCTAssertEqual(op, "flushStatus")
            XCTAssertEqual(sent["operationId"] as? String, operationIds.values.first)
            return try MockURLProtocol.response(json: [
                "id": id, "ok": true,
                "version": ["id": "22222222-2222-4222-8222-222222222222", "path": "/work/large.bin"],
            ])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )

        let result = try await client.finalizeWrite(handleId: "slow-stage")
        XCTAssertEqual(result.version, "22222222-2222-4222-8222-222222222222")
        XCTAssertEqual(flushCalls.values.count, 2)
        XCTAssertEqual(operationIds.values.count, 2)
        XCTAssertEqual(operationIds.values[0], operationIds.values[1])
    }

    func testMaximumWriteChunkFitsTheNegotiatedLoopbackBodyLimit() async throws {
        MockURLProtocol.handler = { request in
            let body = try XCTUnwrap(MockURLProtocol.bodyData(request))
            XCTAssertLessThanOrEqual(body.count, 1_500_000)
            let sent = try JSONSerialization.jsonObject(with: body) as! [String: Any]
            XCTAssertEqual(sent["op"] as? String, "write")
            let id = try XCTUnwrap(sent["id"] as? String)
            let encoded = try XCTUnwrap(sent["data"] as? String)
            XCTAssertEqual(Data(base64Encoded: encoded)?.count, 1_048_576)
            return try MockURLProtocol.response(json: ["id": id, "ok": true, "bytesWritten": 1_048_576])
        }
        let client = DriveBridge(
            connection: try MountConnection(driveId: "d1ed8a9e-82e0-4f68-900e-50737a5a6b40", port: 43210, token: "cap"),
            session: MockURLProtocol.makeSession()
        )
        let written = try await client.write(
            handleId: "large-stage",
            offset: 0,
            data: Data(repeating: 0x5a, count: 1_048_576)
        )
        XCTAssertEqual(written, 1_048_576)
    }
}

private final class LockedList<Element> {
    private let lock = NSLock()
    private var storage: [Element] = []
    var values: [Element] { lock.withLock { storage } }
    func append(_ value: Element) { lock.withLock { storage.append(value) } }
}

private final class MockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let (response, data) = try XCTUnwrap(Self.handler)(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    static func response(json: [String: Any]) throws -> (HTTPURLResponse, Data) {
        let data = try JSONSerialization.data(withJSONObject: json)
        return (HTTPURLResponse(url: URL(string: "http://127.0.0.1:43210/rpc")!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, data)
    }

    static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    static func bodyData(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

private func XCTAssertThrowsErrorAsync<T>(
    _ expression: () async throws -> T,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail("Expected the async expression to throw.", file: file, line: line)
    } catch {}
}
