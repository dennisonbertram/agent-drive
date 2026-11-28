# SETUP-055 walk report: Connect a live Instabox workspace and keep it across logins

Status: partial. No Instabox and no Finder app on the Studio.

1. Console (screenshots/step-1.png). Fresh account Files page: empty state "Ready for your first file", "Connect an agent" button. No mention of mounts, Finder or Instabox. Geometry clean; no console errors.
2. Docs "Live workspace mounts" (step-2.png). Readable code blocks; placeholder SANDBOX_ID; mkdir of the parent only.
3. CLI error sequence (all exit 1, each message quoted exactly):
   - `--sandbox my-sandbox`: "Invalid Instabox sandbox ID; use its exact m\_... ID, not a name or alias." Clear, but nothing says where the ID is found.
   - `--root workspace/project`: "Invalid workspace root; use a normalized absolute sandbox path." Clear.
   - name `bad/name`: "Invalid mount name; use 1-64 letters, digits, "-" or "\_", starting with a letter or digit." Clear.
   - missing parent: "Finder mountpoint parent does not exist: .../Nope". Clear.
   - mkdir of full mountpoint: "Finder mountpoint already exists: .../coordinator". No instruction.
   - valid command with --persist: "Could not find an executable Instabox CLI in PATH or ~/.local/bin." and the entry stays registered (see SETUP-056).
   - second name for the same sandbox folder: "This workspace is already registered as 'coordinator' at ... Use that Finder mount instead of adding an alias." Clear.
   - `mounts add NAME MP --sandbox m_..`: "A --drive ID is required. No drive key is configured for this API." and with --root: "--root is only supported by `connect`."
   - foreground `connect` without the Finder app prints the saved-entry JSON, then "ENOENT ... AgentDriveFinder" and rolls back the registration.
4. Not-walkable: persist success output, Finder row, new/overwrite file behaviour, `cp -n .env`, reboot restore.
5. Mobile (mobile-check.png): docs command index table clips its Purpose column. pageOverflowX 0.

## Flow Log

Specified 7 steps (ideal 3); walked 3 error paths only. Hesitations: sandbox ID source, mkdir of full path, `mounts add` alternate. Re-entry: rerun after failed persist is blocked by the leftover registration. Duplicated info: "sandbox" and "Finder mount" used for a Linux-neutral error.
