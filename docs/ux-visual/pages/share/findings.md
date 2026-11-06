# /s/<id>#k=... share page (localhost:3500, 2026-11-06)

Shots: `shots/<viewport>-<state>.png` (+ `-full`), viewports 1440x900, 768x1024, 390x844; states ready, missing-key, bad-key-format, wrong-key, revoked, not-found, loading, decrypting. Measures: `audit.json` (24 keys). Helper: `helpers/cap.sh`. Second opinions skipped per brief. The expired state was not reachable (the CLI minimum is 30m and the DB is off limits); the revoked state uses the same error card. Wrong-key was produced by pairing the seeded id with another share's valid-format key. Verified by direct inspection of the shots; "measured" items come from audit.json.

## Verdicts

- ready (all viewports): clean, single-card, primary Download is the only high-emphasis element, no page scroll, no overflow (measured pageScrollY 0, overflowX 0). The card is a hardware-console metaphor ("ENCRYPTED FILE TRANSFER", LED, TRANSFER SIZE) rather than a Dropbox-style file card: no file-type icon, no real file size (shows ciphertext size "439 B encrypted"), no sender. Content sits in the top 45% of the screen; the rest is blank at 1440x900 and 390x844.
- missing-key / bad-key-format / wrong-key: the card is clear and the paste-link recovery is good. The wrong-key state reuses the missing-key body ("Ask the sender for the complete link"), which is wrong for a complete link, and arrives only after clicking Download (the "Download" click fails late). The input has no placeholder and the "Use link" button is disabled-grey and 8px taller than the input, so their centres do not align.
- revoked / not-found: clear heading plus a sentence, no dead UI. There is no link back to Agent Drive or any next step; the footer line "Your browser decrypts this file and the key never leaves it" is irrelevant on an error card.
- loading: "Opening secure link" as the title plus "Checking this share link…" is the same fact twice, and the card height changes when content arrives (layout jump measured visually: 213px to 277px card height).
- decrypting: the button label changes to "Decrypting…" and fades; there is no progress for large files (download phase and decrypt phase both read "Decrypting…"), and the LED does not change.

## Findings

| id  | level     | element                                     | problem                                                                                                                                    | norm   | evidence                                    | sev | found by | verified                            |
| --- | --------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------- | --- | -------- | ----------------------------------- |
| SH1 | page      | ready card                                  | Shows ciphertext size ("439 B encrypted"), no file-type icon, no sender/drive; looks like hardware console, not a familiar file-share card | P1, C1 | shots/1440x900-ready.png                    | P2  | own      | observed                            |
| SH2 | component | wrong-key error body                        | Same "ask for the complete link" text as missing key, though the link is complete; failure only appears after Download is clicked          | C1, I3 | shots/1440x900-wrong-key.png                | P1  | own      | observed                            |
| SH3 | group     | error cards (revoked, not-found, wrong key) | No way forward (no "Get Agent Drive" / home link); dead end for a recipient                                                                | I3, L7 | 1440x900-revoked.png, 390x844-not-found.png | P2  | own      | observed                            |
| SH4 | component | downloading/decrypting button               | Only a disabled "Decrypting…" label; no progress or completion message after the file saves; no success state at all                       | I2     | 1440x900-decrypting.png                     | P1  | own      | observed (completion not exercised) |
| SH5 | component | paste form                                  | Input has no placeholder; button height (48) vs input (40) misaligns centres by 3px; disabled "Use link" low contrast                      | H6, A1 | 390x844-missing-key.png                     | P2  | own      | observed                            |
| SH6 | page      | loading                                     | Title "Opening secure link" duplicates body "Checking this share link…"; card grows after load                                             | C2, L5 | 1440x900-loading.png vs ready               | P3  | own      | observed                            |
| SH7 | page      | footer note                                 | Encryption reassurance repeated on error cards where it is irrelevant; mono tiny gray text                                                 | C4, D1 | all error shots                             | P3  | own      | observed                            |
| SH8 | page      | layout                                      | Content hugs the top ~45% of viewport with blank bottom; card not vertically balanced at 1440x900                                          | D2     | 1440x900-ready.png                          | P3  | own      | observed                            |
| SH9 | component | audit smallTargets                          | 1 target below 24px on every state                                                                                                         | I4     | audit.json share/\*/layout.smallTargets     | P3  | own      | measured                            |

## Excellent as is

- One clear primary action; no scroll or overflow at any viewport.
- Paste-the-full-link recovery for key problems.
- Error headings are plain, specific, and name the next step (revoked/expired/not found).
- Brand mark aligns to the card's left edge; stacked layout works at 390 with 16px gutters.
