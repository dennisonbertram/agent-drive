import XCTest
@testable import AgentDriveFinderCore

final class DomainCleanupPolicyTests: XCTestCase {
    func testCleanupRequiresTemporaryModeCreationAndCurrentSessionOwnership() {
        XCTAssertFalse(ProviderDomainCleanupPolicy.shouldRemove(
            temporaryDomain: nil, createdByCurrentSession: true, ownsSession: true
        ))
        XCTAssertFalse(ProviderDomainCleanupPolicy.shouldRemove(
            temporaryDomain: false, createdByCurrentSession: true, ownsSession: true
        ))
        XCTAssertFalse(ProviderDomainCleanupPolicy.shouldRemove(
            temporaryDomain: true, createdByCurrentSession: false, ownsSession: true
        ))
        XCTAssertFalse(ProviderDomainCleanupPolicy.shouldRemove(
            temporaryDomain: true, createdByCurrentSession: true, ownsSession: false
        ))
        XCTAssertTrue(ProviderDomainCleanupPolicy.shouldRemove(
            temporaryDomain: true, createdByCurrentSession: true, ownsSession: true
        ))
    }
}
