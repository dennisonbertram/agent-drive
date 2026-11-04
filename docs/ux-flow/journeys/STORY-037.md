# STORY-037: Agent shares a report via CLI; recipient downloads; later revoke

Verdict: **acceptable**. Actual 3 steps for the sender (run share, copy url from JSON, paste in email) vs ideal 1; recipient 2 (open link, Download); revoke is a separate 2-command sequence.
Evidence legend: [M] measured live by lead, [S] screenshot, [C] code, [Cat] catalog, [?] suspected.

## Friction Scorecard

| Check          | Finding                                                                                                                                                                                                                                                  | Evidence                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Steps vs ideal | Sender: 3 vs 1. The command returns a JSON object with id, path, versionId, expiresAt, url; the user has to pick out `url` and copy it without breaking the `#k=` part. Recipient: open link, click Download = 2, minimal.                               | [M] CLI output; [Cat] steps 1-3; [C] cli.ts:223-228 |
| Decisions      | `--expires-in` is optional with a 7-day server default that the CLI does not announce except via `expiresAt`. Reasonable default; 1m is rejected (min 2m), an inconsistency with MCP/REST (60 s).                                                        | [Cat] variations, STORY-038; [C] cli.ts:337         |
| Re-entry       | Drive id and path typed every call. `share list` shows id + revokedAt but no URL, so a lost link cannot be recovered and the user must re-share. Revoke needs share id, which they must remember or list.                                                | [M] share list output; [C] cli.ts:216-220           |
| Confirmations  | `share revoke <id>` has none, which is right for a reversible-by-reshare action.                                                                                                                                                                         | [M] revoke worked                                   |
| Dead ends      | (1) Console has no share UI, so a human cannot see, copy or revoke links there. (2) After revoke, a recipient with the fragment-less link sees "missing a valid decryption key", which tells them to ask for the complete link, not that it was revoked. | [M]; [S] 11                                         |
| Hesitations    | Copying whole JSON line breaks the link [Cat edge cases]. The URL is a secret that lands in shell history. Share page shows only encrypted size, not decrypted size or file type.                                                                        | [Cat]; [M] share page                               |

## Take-away Pass

**CLI output**

- `id`, `path`, `versionId` are not needed to send the link. Print the URL as the primary line (with expiry in plain words), keep full JSON behind `--json`. [M]

**Share page (recipient)**

- Eyebrow "ENCRYPTED FILE TRANSFER" and footer "Client-side encryption. The key stays in your browser." and "Your browser decrypts this file. No sign-in required." together say the same thing three times. Keep one line beside the button. [M text; [C] share-client.tsx:164-186]
- "1,500,057 encrypted bytes" is not meaningful to a client. Show a human size (about 1.5 MB). [M]
- Expiry shown as full locale date-time with seconds ("11/3/2026, 9:17:49 PM"). A relative phrase ("expires in 1 hour") or date without seconds is easier to read. [M]
- Brand link and lock icon: decoration, harmless.
- Primary action: single Download button is dominant. Already good. [C] share-client.tsx:175-181

**Error screen (11-share-missing-key)**

- Single heading + one sentence: minimal. [S] 11

**Console**

- No share list or revoke control exists, so the sender (a human) must use CLI to manage links they created. [M]

## The Simpler Version

Sender

1. Run `agent-drive share /reports/result.csv --drive ID --expires-in 24h`. Output: the URL on its own line and "Expires Tue 4 Nov 9:17 PM". JSON only with `--json`.
2. Paste into email.

That is 2 steps instead of 3, close to the ideal 1.

Recipient

1. Open link. The page shows file name, readable size, expiry, Download button.
2. Click Download. (Auto-start on open is possible but removes the user's control; keep the click.)

Revoke

1. `agent-drive share revoke <id>`; `share list` should include the file path and expiry so the id is findable. Console list with Revoke would help a human, but the catalog says console cannot create shares, so adding it is a separate product decision.

Concrete changes

- Default `share` output to the URL line; `--json` for full object. [C cli.ts:223-228]
- `share list` adds path and expiresAt columns. [M it returned id + revokedAt only]
- Share page: human size, shorter expiry, one privacy sentence.
- Check share status before the fragment check: in `share-client.tsx` the effect returns early when there is no key (`if (!fileKey) return;`), so a revoked or expired link opened without `#k` never calls the API and shows "missing key". Fetch metadata first, or at least when the fragment is empty, so revoked/expired headings (`share_revoked`, `share_expired` exist in errorHeadings) show. [C share-client.tsx:19-24, 67; [M] screenshot 11 behavior]

## Clarity Issues

- Revoked link, fragment stripped (e.g. chat app drops the `#`): the page says "missing a valid decryption key" instead of revoked. Measured without the fragment only; with the fragment the code has a "Share link revoked" heading but this was not observed live [?]. [S] 11; [C] share-client.tsx:19-23
- "Ask the sender for the complete link, including everything after the # symbol" assumes the recipient knows what the # symbol is. Say "the full link, including the long text after #". [S] 11
- Missing-key and wrong-key (decryption-failed) share the same advice text. [C] share-client.tsx:159
- "encrypted bytes" size: unclear whether the downloaded file will be that size. [M]
- Notices that 7 days is the default are missing; the CLI help only lists examples. [C cli.ts:337]
- Terms: "share", "link", "transfer" are used for the same object across CLI (share), page ("ENCRYPTED FILE TRANSFER") and catalog ("link"). Pick "share link". [M]

Already minimal: recipient flow (open, Download, no sign-in); revoke command worked and the API returned 410 [M].
