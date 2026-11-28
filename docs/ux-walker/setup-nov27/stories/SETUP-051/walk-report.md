# SETUP-051 walk report: Mount a drive in Finder for the first time

Status: partial. Target: local app 0.5.1 at localhost:3811; CLI run on the Mac Studio (no Agent Drive.app installed).

1. Landing page (screenshots/step-1.png). Header: Pricing, Docs, Sign in, Sign up free. No mention of Finder or mount anywhere on the page. Geometry: pageOverflowX 0; script reported nav/footer "uneven rows" and many "wrapped controls" that the screenshot does not show (false positives). Console errors: none.
2. Docs /docs/cli (step-2.png). The Finder app paragraph is one dense block inside "Install and configuration". Link text "Agent Drive Finder 0.3.1" is clear. Docs say opening the app does not open a window (clear). Not walkable: following the GitHub download and drag to /Applications.
3. Login (step-3.png). `login --no-browser` printed an approve link and two codes (pairing code HKJS-TRTL and a verification code). With AGENT_DRIVE_API_URL lacking /api the first attempt printed only "Agent Drive refused the login request: 404". After using .../api, the approve page asked to type the verification code, approval worked, and the CLI printed the drive ID and backup reminder. Page clean.
4. Not-walkable: double-click the app, enable extension, Finder row, drag a file, Ctrl+C unmount.
5. CLI `mount /Users/agent/uxw/m051/AgentDrive` without the app: "ENOENT: no such file or directory, stat '/Applications/Agent Drive.app/Contents/MacOS/AgentDriveFinder'". `AGENT_DRIVE_FINDER_HELPER=relative` gives "Finder helper override must be an absolute path" (clear). Mount with no argument prints "Usage: mount MOUNTPOINT [--drive ID] [--read-only] | mount --name NAME".
6. `--help`: mounts lines listed twice.
   Mobile: docs page checked at 390x844 (SETUP-055/screenshots/mobile-check.png).

## Flow Log

- Specified: 7 steps; ideal path 5. Needed here: could reach 3 (docs, login, mount) before the missing app blocked.
- Hesitations: where to find the app (no web/console pointer); raw ENOENT does not say "install the app".
- Re-entry: login needed two attempts because of the URL.
- Duplicated info: two codes on the approve page; mounts commands duplicated in help.
