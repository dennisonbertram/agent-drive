# STORY-026 walk report (lane B)

Result: PASS. Key loads from a recovery file, and downloads were confirmed to save real, correctly decrypted files (see "Download evidence"). Two minor message/feedback findings.

Accounts: e2e_walkerb_new (drive "Research workspace", recovery file saved from the console receipt, JSON {format agent-drive-key-v1, driveId, key}) and seeded e2e_uxreview / research-bot (adcred1 bundle).

1. Files tab with no key: badge "KEY REQUIRED FOR DOWNLOADS", every Download button disabled (s2-0-keyrequired.png). Clicked "Load drive key": dialog (step-1-dialog.png) with password field, "Or choose a recovery file or credentials bundle", orange "Load key".
2. Chose the .key.json: the filename shows next to the picker and the password field fills with 43 dots (s2-1-keyjson-chosen.png). Nothing else says "accepted", but the filename plus dots is visible; the extra click on "Load key" is still needed.
3. Clicked "Load key": dialog closes, badge "KEY LOADED", Download enabled, "Download recovery file" in banner (s2-2-loaded.png). 3 actions after opening (pick, Load key, plus the open) = ideal 2 + the open click.
4. Download evidence (agent-browser download capture):
   - handoff.md (62 B ciphertext): file saved, content "hello from trace-bot" = what the agent wrote. Page showed "File decrypted in your browser. Download started." with Dismiss (s3-download-done.png).
   - Seeded research-bot via adcred1 bundle: /outputs/reports/summary.pdf saved and `file` reports "PDF document, version 1.4"; /outputs/images/chart-1.png saved as "PNG image data, 64 x 40"; /README.md saved as ASCII text with the expected content. Each finished in about 1 second. Saved at scratchpad/dl-b/files/.
5. Variations (screenshots var-\*.png), each with the dialog error banner:
   - key file for another drive: "This recovery file does not belong to the selected drive." (OK)
   - 20 KB file: "This is not a valid drive key file." (OK)
   - notes.txt: "Choose a JSON recovery key file downloaded from this console." (OK)
   - bundle for a different drive (nightly-builds): "The bundle does not contain a key for this drive." (OK)
   - {"hello":"world"} JSON: shows "This recovery file does not belong to the selected drive." (catalog expects the "Choose a JSON..." text; the message misleads, it is not a recovery file at all).
   - After any rejected file the chosen filename stays in the picker while the key field is empty; pressing "Load key" then gives the browser's native "Please fill out this field." bubble (var-random.json.png), which is confusing.
6. Mobile 390x844 (mobile-check.png): dialog fits, no overflow. Geometry audit: only intentional unequal widths. Clean.

## Flow log

- Steps: open dialog, choose file, Load key = 3 (ideal 2). Hesitation: after choosing the file, whether to click again (the dots are the only hint).
- Failed-file state is sticky: error remains while the next file is chosen until Load key.
