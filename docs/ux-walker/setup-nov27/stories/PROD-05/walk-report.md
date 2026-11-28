# Walk report PROD-05: macOS Finder app download and mount docs (look only)

Story reference: SETUP-009 (variation), Finder download. Target: https://agentdrive.xyz release 0.5.1, signed out, viewport 1280x800 plus one 390x844 check. Session uxw-prod-public.

Status: partial. The download link exists and the instructions are specific, but it is hidden in the CLI reference and the signed-or-not wording conflicts (F-PROD-01-4, F-PROD-01-5). Nothing was downloaded.

## Steps

1. Action: Find the Finder app from the site
   Screenshot: step-1-cli-macos.png
   Shows: No landing, footer or docs-index mention; guessed URLs /desktop, /download, /finder, /app, /mac, /docs/mount|desktop|finder all 404. Found in /docs/cli, 'macOS requirements and unmounting': link 'Agent Drive Finder 0.3.1' -> GitHub release zip (href recorded, not followed). Requires macOS 13+, drag to /Applications, run `agent-drive mount "$HOME/AgentDrive"`.

2. Action: CLI reference at 390px
   Screenshot: step-2-cli-mobile.png
   Shows: Renders without overflow.

## Findings

- F-PROD-01-4 (medium): The macOS Finder app is not discoverable. Landing, footer, docs index, sidebar and llms.txt never mention it. /desktop, /download, /finder, /mac, /docs/mount, /docs/desktop, /docs/finder all return 404. The only download link (GitHub release zip 'Agent Drive Finder 0.3.1') is inside two paragraphs of the 48 KB CLI reference.
- F-PROD-01-5 (medium): The CLI reference contradicts itself on whether the Finder app is signed. One sentence says 'the separate signed Agent Drive app' and 'signed Agent Drive.app'; the next says the macOS builder workflow 'compiles the app but does not sign, notarize, or publish it'. A new user cannot tell whether macOS will warn about an unidentified developer.

## Flow Log

The download is a GitHub release zip versioned 0.3.1, separate from the CLI 0.5.1; the page does not say they are compatible. Download not performed by design.
