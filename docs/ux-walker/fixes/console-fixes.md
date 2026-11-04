# Console fixes (branch ux-walker/console-fixes)

Files: apps/web/app/(app)/console/console.tsx, tests/e2e/console.spec.ts.

- F-032-001: filtering to no matches now shows a row `No loaded files match “term”.` (Files and Trash share the table code). Column widths unchanged; row spans all 4 columns.
- F-032-002: removed the Trash confirm (recoverable) and added notice `Moved {path} to Trash. Restore it from the Trash tab.` Revoke-access confirms (destructive) kept. E2E test no longer registers a dialog handler for Trash.
- F-034-001: newest version (by createdAt) shows "· Current" and no Restore button.
- F-034-002: `__console__` shown as `Console` in file Author column, version rows, and Usage tab (was "Human console").
- #21: CLI block uses window.location.origin (placeholder during SSR) and the selected drive id (placeholder `<drive-id>` if none).
- Sidebar badge: now shows loaded file count for the selected drive, hidden when no drive is selected. (Count is of loaded files, and is 0 on other tabs until files load.)
- Plurals: "1 agent", "1 active key" in Agents tab, per-agent badge, API keys tab.

Verification: tsc --noEmit clean; eslint 0 errors (1 pre-existing warning); vitest unit 21 files / 77 tests pass; e2e not run (Postgres/MinIO not reachable on 15432/19000); no browser check.
Not fixed: none. Sidebar badge may read stale when switching to non-file tabs (uses loaded fileItems for the current tab scope).
