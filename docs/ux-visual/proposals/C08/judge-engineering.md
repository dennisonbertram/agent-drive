# C08 engineering judge (risk, scope, reuse, testability, security)

Scores 1-5 per criterion (effort/risk: 5 = lowest risk). Weighted total uses rubric weights (x3, x2, x2, x2, x2, x1; max 60).

| Option | Criteria | Simplicity | Consistency | Usability | Visual | Effort/risk | Weighted |
|---|---|---|---|---|---|---|---|
| A Share action + 2 dialogs | 5 | 5 | 5 | 4 | 3 | 4 | 53 |
| B Shared filter + chip | 4 | 3 | 4 | 4 | 4 | 2 | 44 |
| C Share dialog + Shared page | 4 | 2 | 3 | 4 | 4 | 2 | 40 |

- Feasibility, checked in code: `createShare` in `packages/agent-drive/src/client.ts` does a metadata GET (`metadataOnly=1`), `unwrapFileKey(wrappedKey, driveKey)`, then POSTs `{path, versionId, expiresAt}`, and builds `/s/<id>#k=<fileKey>`. The console already holds `driveKeys[selected]` and imports from `crypto.ts`, and the console session has the `share` scope (handler.ts `scopeNames`, `need(auth,'share')`). So browser share creation is real and fits the model: the file key exists only in page memory and in the URL fragment, which browsers do not send, and the POST body carries no key. All three proposals state this correctly.
- Constraints they also state correctly: the list API returns no URL, so only links created in this session are copyable. A should adopt C's help line ("Link copied at creation only") so the list does not look broken.
- Bug to avoid in A: "Copy link" creates the share on click. If the clipboard write fails (Safari after an await), a second click must reuse the URL already in memory, not create a duplicate share. Use the ClipboardItem promise form A mentions.
- Do not write the URL to localStorage, logs, analytics or the query string. Add a test that the POST body lacks the file key and that the URL has `#k=` with the 43-char key.
- B needs the full share list on every Files load (paged at 100) to draw the chip, plus two views sharing state. C adds a sixth nav item while ux-flow is trying to cut tabs (C "Risks").
- Dependencies: unlock prompt from C05-A (`pendingAction`), `ConfirmDialog` and toast from C03, Share item in the C03 row menu.

**Pick: A.** Grafts: C's "created-at-share-time only" help line; B's confirm-before-Trash only when the file has active links, loaded lazily on click as A already proposes.
