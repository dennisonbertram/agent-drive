import XCTest
@testable import AgentDriveFinderCore

final class PartialRangeTests: XCTestCase {
    func testAlignedFetchCoversRequestedSpanWithBoundedLength() throws {
        XCTAssertEqual(
            try AlignedByteRange.covering(offset: 17, length: 19, alignment: 16, fileSize: 100),
            AlignedByteRange(offset: 16, length: 32)
        )
    }

    func testFetchRangeClampsAtEndOfFile() throws {
        XCTAssertEqual(
            try AlignedByteRange.covering(offset: 88, length: 12, alignment: 16, fileSize: 100),
            AlignedByteRange(offset: 80, length: 20)
        )
    }

    func testRejectsInvalidOrOutOfFileRequests() {
        XCTAssertThrowsError(try AlignedByteRange.covering(offset: -1, length: 1, alignment: 1, fileSize: 10))
        XCTAssertThrowsError(try AlignedByteRange.covering(offset: 9, length: 2, alignment: 1, fileSize: 10))
        XCTAssertThrowsError(try AlignedByteRange.covering(offset: 0, length: 1, alignment: 0, fileSize: 10))
    }
}
