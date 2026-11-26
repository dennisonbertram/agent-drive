import FileProvider
import Foundation

public enum ProviderEnumerationState {
    public static let initialSyncAnchor = Data("initial".utf8)

    public static func cursor(for page: NSFileProviderPage) throws -> String? {
        if page == (NSFileProviderPage.initialPageSortedByName as NSFileProviderPage) ||
            page == (NSFileProviderPage.initialPageSortedByDate as NSFileProviderPage) {
            return nil
        }
        guard let cursor = String(data: page.rawValue, encoding: .utf8),
              !cursor.isEmpty, cursor.utf8.count <= 4_096
        else { throw BridgeClientError.invalidPath }
        return cursor
    }

    public static func page(after cursor: String?) -> NSFileProviderPage? {
        cursor.map { NSFileProviderPage(rawValue: Data($0.utf8)) }
    }

    public static func isCurrent(_ received: NSFileProviderSyncAnchor, expected: Data) -> Bool {
        received.rawValue == expected
    }
}
