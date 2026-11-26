/// A temporary File Provider domain is removable only by the session that
/// explicitly created it while it still owns the drive's connection record.
public enum ProviderDomainCleanupPolicy {
    public static func shouldRemove(
        temporaryDomain: Bool?,
        createdByCurrentSession: Bool,
        ownsSession: Bool
    ) -> Bool {
        temporaryDomain == true && createdByCurrentSession && ownsSession
    }
}
