# Walk report: SETUP-067 Local capture with the CLI instead of OpenRouter

Status: **partial**

Environment: local release 0.5.1 app at http://localhost:3811 with a test session (no Clerk). Browser: agent-browser, 1280x800 plus one 390x844 check. Clerk sign-in and reverification cannot be seen here.

Geometry audit: pageOverflowX 0; only unevenRows hit is the Refresh/Connect an agent button pair (different label widths, intentional); wrappedControls hit on Browse/Recent/Shared is a false positive (screenshot shows one line).

## Steps

### Step 1: Open Capture... on a drive and read the Local agents section
- Screenshot: `/Users/dennison/develop/agent-drive-ux-setup/docs/ux-walker/setup-nov27/stories/SETUP-059/screenshots/step-2.png`
- What the screenshot shows: Text: 'Connect to Agent Drive and load this drive's key on your agent's machine first. Run Claude Code or Codex through capture to save encrypted traces under /traces. Check terminal output: capture may be disabled, uploads may be queued, or calls may not be captured.' Two code boxes: `npm install -g @dennisonbertram/agent-drive` and `agent-drive capture --drive <id> -- claude`, each with a 'Copy' button. Copy buttons work ('Copied').
- Geometry: pass

### Step 2: CLI: `agent-drive capture` with no arguments / bad agent name / no login
- What the screenshot shows: Exact outputs: `Usage: capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]`; `--agent must be 1-40 characters: lowercase letters, digits, ".", "_" or "-".`; and with no saved login `capture disabled: API configuration is missing. Run `agent-drive login` or set AGENT_DRIVE_API_URL and AGENT_DRIVE_API_KEY; running echo without capture` followed by the command's own output. All clear and actionable, and the wrapped command still runs.
- Geometry: n/a

### Step 3: CLI: `agent-drive login --no-browser` against the server (needed before a real capture run)
- What the screenshot shows: Blocked. With AGENT_DRIVE_API_URL=http://localhost:3811 the output was `Agent Drive refused the login request: 404`. With http://localhost:3811/api (the form the app's llms.txt shows) it was `Agent Drive refused the login request: slow_down` on every attempt for about 15 minutes (the server is shared by many walkers). So no drive key could be saved and no traces were captured. Not walked: running a real capture, uploads summary line, the Traces view after capture.
- Geometry: n/a

## Flow Log

Ideal path 4 (Capture..., Copy install command, Copy capture command, run in terminal). The web half (open dialog, two copy buttons) took 3 actions and worked. The terminal half is **not walked** beyond argument errors because CLI login was refused (404 / slow_down). Hesitation: the dialog says 'Check terminal output' but lists none of the messages; the CLI messages themselves are good. The 404 on a base URL without /api is an unfriendly error ('refused the login request: 404' does not say the URL is wrong). Mobile check: same dialog family as SETUP-064 step 3 at 390px (fits).
