# C05 engineering judge (risk, scope, reuse, testability, security)

Scores 1-5 per criterion (effort/risk: 5 = lowest risk). Weighted total uses rubric weights (x3, x2, x2, x2, x2, x1; max 60).

| Option | Criteria | Simplicity | Consistency | Usability | Visual | Effort/risk | Weighted |
|---|---|---|---|---|---|---|---|
| A Dialog + one chip | 5 | 4 | 4 | 4 | 3 | 4 | 49 |
| B Sheet + switcher tile | 3 | 2 | 3 | 4 | 4 | 1 | 36 |
| C Lock toggle | 4 | 3 | 3 | 3 | 4 | 3 | 41 |

- A reuses the existing `unlock` Dialog, `loadKeyFile` and a `pendingDownload` ref. B only works if C04-B ships (Sheet, switcher tile) and adds drop-anywhere and an idle lock. C introduces "Locked/Unlocked" as a second vocabulary beside "key"/"recovery file" (C "Risks") and makes a state label act as a toggle.
- "Remember on this device", checked against the code: the drive key today lives only in React state (`driveKeys`, console.tsx:260). All three proposals persist it as AES-GCM ciphertext in IndexedDB with a non-extractable wrapping `CryptoKey` in the same store. Be clear about what that buys. The wrapping key sits next to the ciphertext, and any script on the console origin can still ask it to decrypt, so XSS and anyone with the browser profile get the drive key either way. It only avoids a plaintext key in devtools storage. I found no Content-Security-Policy in `apps/web`, so XSS exposure is not reduced by headers. A's wording ("protects against someone reading browser storage without the page") overstates the protection.
- `apps/web/src/device/seal.ts` is ECDH sealing for the browser-to-agent handoff. Nothing in it is reusable for at-rest storage except small base64 helpers (and those are not exported).
- The server never sees the key under any option, so the model "drive keys only in browser or agents" holds. Persistence widens the window from the tab session to the profile lifetime. Acceptable only as opt-in, off by default, per drive, with plain wording: "Anyone who can use this browser profile, or run a script on this site, can open this drive."
- Recommend adding B/C's idle auto-lock (key leaves memory after 30 minutes unless remembered). It is a few lines and shrinks the default exposure. Also clear remembered keys on "Forget key" and on sign-out.
- Cross-cluster conflict: C05 removes the backup banner, while C06 criterion 4 asks the banner to read "Key backed up". Resolve in favor of the chip: it shows "Key needed" (red) or "Key loaded" (green), with a red dot and a "Not backed up" menu line when no backup is recorded, and "Key backed up" text in the menu after C06's fix. Do not keep both banner and chip.
- Test: click Download with no key opens the prompt and the download starts after file choice (verify Safari); wrong-drive file shows the reserved error with 0 px shift; remembered key survives reload and is gone after Forget; a unit test that the stored IndexedDB record is not the plain key string.

**Pick: A.** Grafts: idle auto-lock from B/C, the "state label" wording rule from C (word plus color, not color alone). Ship "Remember on this device" as a separate small PR after the prompt and chip, so it can be reviewed on its own.
