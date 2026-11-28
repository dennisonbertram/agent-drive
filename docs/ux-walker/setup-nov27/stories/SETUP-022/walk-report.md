# SETUP-022 walk report: use one of my drives (recovery file / key handoff)

User e2e_approve_connect_024 (account with two drives, both named `luis-claude`), request `hana-cursor`, code `LZFJ-SZGH`.
Recovery file download from the console is not walkable (no passphrase / account key on this copy); I used the credentials bundle (`adcred1.…`) from `agent-drive credentials export --to <file>`, which the page accepts in the Drive key field. A file chosen with the file input was not exercised; the browser file chooser is not scripted here.

## Steps

1. Opened the link, opened Details (screenshots/step-1.png). The link "Use one of my drives instead (needs its recovery file)" sits at the bottom of the Details panel as a small underlined text link, above the delegate checkbox. It is not visible until Details is opened.
2. Clicked it (screenshots/step-2.png). Summary becomes "Existing drive · choose below"; the form shows Drive select, Drive key (placeholder cut off: "Paste the drive key or a"), "Or choose a file", "Only allow writes under (optional)", Read only, and a secondary "Use a new drive instead" button. The Drive select lists two options both called `luis-claude` ("luis-claude" and "luis-claude (Dennisons-Mac-Studio.local)"); the user cannot tell which is which. The DOM order is Drive, Drive key, folder, file; visually the folder field sits right of Drive and the file chooser right of Drive key, so "Or choose a file" reads as an alternative to the key but is under the folder field. Details, once opened in this mode, shows only Machine and Account and the delegate checkbox.
3. Clicked Approve with everything empty (screenshots/step-3.png): the error shown is only the verification code message; the empty Drive key is not flagged. After fixing one, the other would appear (one error at a time).
4. Typed `not a key at all` and a correct verification code: "This is not a valid drive key. Paste the key from the console, or choose a recovery file or credentials bundle." (screenshots/step-4.png), shown under the key field with red borders. Clear.
5. Pasted the bundle, ticked Read only, typed folder `papers/`: "Enter a folder that starts with / and does not end with /, for example /inbox/agent." under the folder field (screenshots/step-5.png). The Read only box is checked while the write-folder field stays enabled, though read only has no writes.
6. Details open in this mode (screenshots/step-6.png) shows the delegate checkbox between Account and the form.
7. Mobile 390x844 (screenshots/step-7.png): single column, no horizontal scroll (390); the Approve button is a sticky bar over the form, partly covering the hint text, and the Next.js dev badge sits over it (dev-only badge).
8. Fixed folder to `/papers`, Approve: done card "You approved hana-cursor to read the drive luis-claude. Return to your agent to finish setup and confirm it is ready." plus grey line "This drive has nothing to check the key against, so it could not be checked before sending." (screenshots/step-8.png). The card does not mention the `/papers` folder.
9. CLI output for the agent: `Logged in as agent hana-cursor.`, `Scopes: read`, `Writes limited to: /papers`. A read-only key says writes are limited to /papers, which is contradictory.

## Flow Log

- Steps specified: 9. Steps needed: 8 (open Details, switch mode, choose drive, paste key, tick Read only, folder, verification code, approve) plus error-recovery retries.
- Hesitations: the link wording says "needs its recovery file" while pasting a key/bundle also works; two drives with identical names; Read only plus folder.
- Re-entry: the verification code and key are not lost after an error (good).
- Duplicated info: the paragraph "Your browser seals the key..." appears in the form and the previous mode's paragraph is replaced (fine).
- Verdict: PASS with medium findings.
