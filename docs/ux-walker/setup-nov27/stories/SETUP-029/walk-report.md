# SETUP-029 First put, get, compare and share - walk report

Status: PARTIAL. CLI steps pass. Colleague download in the browser could not complete: the share page fetched the ciphertext from `http://127.0.0.1:9811/agent-drive-local/objects/...` (local object store), which is not reachable from this browser (test environment), so it showed "Share unavailable". The pre-download page, revoked page and missing-key page were walked.

Account: reused the SETUP-026 agent (home copied to backup-first-file-029) because new device logins were rate limited (`Agent Drive refused the login request: slow_down`). `check ok` was true before starting.

1. `agent-drive put ./summary.pdf /outputs/summary.pdf` (no --drive, one saved drive): one JSON line with id, path, ciphertextSize, folderUrl `http://localhost:3811/console?drive=<id>&path=%2Foutputs`. Works without --drive although help shows `--drive ID`. Output has no field named "version" (it is `id`); fine. PASS.
2. `get ... --output ./summary-copy.pdf` then `cmp` -> JSON, then silent cmp ("same"). PASS. `get` without --output on binary: `Binary output requires --output.` exit 1 (clear).
3. `share /outputs/summary.pdf --expires-in 24h` -> JSON id, path, versionId, expiresAt, url (`http://localhost:3811/s/<id>#k=...`). PASS. `share list` -> items with status active. No flag -> expiry 7 days (observed).
4. Colleague page (screenshots/step-4-share-page.png): "ENCRYPTED FILE TRANSFER", file name `summary.pdf`, SIZE 3 KB, LINK EXPIRES Nov 28, 2026, 6:11 PM EST, one orange Download button, footer "Your browser decrypts this file and the key never leaves it. No sign-in required." Clean. Geometry: no overflow; Download flagged as wrapped control (false positive). Empty area under the button inside the card (~50px) is the empty status region; minor.
   After clicking Download (step-4b-after-download.png): card "Share unavailable / The file could not be downloaded. Check your connection and try again." with `Try again` button and `Go to Agent Drive` link touching with no gap (button right edge x=500, link starts x=500). Mobile 390x844 (step-4c-mobile.png) same: reflows, no overflow, same touching pair. Network: GET /api/shares/<id> 200, then GET 127.0.0.1:9811/... storage URL (failed, environment).
5. Revoke: `share revoke <id>` -> `{"id":..,"revokedAt":..}`; `share list` status `revoked`. Page (step-5-revoked.png): "Share link revoked / The sender turned this link off. Ask them for a new link if you still need the file." Good copy.
   Link without fragment (step-5b-no-fragment.png): "This link is missing a valid decryption key / Ask the sender for the complete link, including everything after the # symbol." with a paste field and disabled `Use link`. Good recovery path.

Error cases: `--expires-in 90s` -> `--expires-in must use a duration such as 30m, 24h, or 7d.` (story text expected a "between 2m and 30d" message; the real message gives no min or max and does not say seconds are unsupported). `--expires-in 24` -> same message. Re-`put` same path -> `The file already exists.\nCurrent version: <id>. Read the file again, merge your change, then retry with --if-version <id>.` exit 1: for a person who just wants to replace the file the hint never mentions --overwrite.
Not walked: console folderUrl and share dialog (shared browser cookie is overwritten by other walkers, console showed other users' data); link expiry (24 h).

## Flow Log
- Ideal path 3 (put, share, send URL): achieved in 2 CLI commands. get/cmp optional verification used, 2 more.
- Hesitations: help shows `--drive ID` as if required. Re-put conflict hint omits --overwrite.
- Re-entry: none. Duplicated info: none.
