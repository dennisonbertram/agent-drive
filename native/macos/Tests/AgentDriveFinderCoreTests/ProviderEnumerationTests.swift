import FileProvider
import XCTest
@testable import AgentDriveFinderCore

final class ProviderEnumerationTests: XCTestCase {
    func testBothInitialSortPagesAndRemotePageCursorsAreRecognized() throws {
        XCTAssertNil(try ProviderEnumerationState.cursor(for: NSFileProviderPage.initialPageSortedByName as NSFileProviderPage))
        XCTAssertNil(try ProviderEnumerationState.cursor(for: NSFileProviderPage.initialPageSortedByDate as NSFileProviderPage))
        XCTAssertEqual(try ProviderEnumerationState.cursor(for: NSFileProviderPage(rawValue: Data("cursor-2".utf8))), "cursor-2")
        XCTAssertThrowsError(try ProviderEnumerationState.cursor(for: NSFileProviderPage(rawValue: Data([0xff]))))
    }

    func testPostRestartUnknownAnchorExpiresInsteadOfBeingAccepted() {
        let anchor = NSFileProviderSyncAnchor(rawValue: Data("prior-process-anchor".utf8))
        XCTAssertFalse(ProviderEnumerationState.isCurrent(anchor, expected: ProviderEnumerationState.initialSyncAnchor))
        XCTAssertTrue(ProviderEnumerationState.isCurrent(
            NSFileProviderSyncAnchor(rawValue: ProviderEnumerationState.initialSyncAnchor),
            expected: ProviderEnumerationState.initialSyncAnchor
        ))
    }

    func testRootLevelItemUsesRootContainerAsItsParentPath() {
        XCTAssertEqual(ItemPath.parentPath(for: "/notes.txt"), "/")
        XCTAssertEqual(ItemPath.parentPath(for: "/docs/notes.txt"), "/docs")
        XCTAssertEqual(ItemPath.parentPath(for: "/"), "/")
    }
}
