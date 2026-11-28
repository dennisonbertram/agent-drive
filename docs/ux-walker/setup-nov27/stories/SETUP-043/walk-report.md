# SETUP-043 walk report (medium): Hand a drive to a second laptop agent with grant --verify

User e2e_second_agent_sandbox_43. Two CLI homes on the Studio: 043-a ("priya-mbp agent", approved with delegate) and 043-b ("codex-desktop"). Status: PASS with findings.

## Steps

1. Laptop agent login + approve with delegate (same /connect page as SETUP-044, not re-shot). CLI: `Scopes: read write delete share delegate`.
2. New agent: `agent-drive login --name codex-desktop --no-browser` printed link, `Check that the code matches: NRRF-CTRR`, `Verification code: 7f15 0bc8 903e d5e4`, `Waiting for approval...`.
3. Edge cases on the granting machine: no --verify -> `grant requires --verify <verification code>: the code the new agent printed under "Verification code:" when it ran `agent-drive login`. Ask the human for it.` (clear). Wrong code (quoted) -> `The verification code does not match this request. Check the code the new agent printed; if it is right, do not grant — the request may have been tampered with.` (alarming for a typo, as the story says). Unknown pairing code with --verify -> `Pass --verify with the verification code the new agent printed, exactly as shown ("a1b2 c3d4 e5f6 7890").` which is misleading (the verification code was right; the pairing code was wrong).
4. `agent-drive grant NRRF-CTRR --verify "7f15 0bc8 903e d5e4" --write-path /codex` -> `Request from codex-desktop on Dennisons-Mac-Studio.local, made <ts>.` and `Offered drive <id> to codex-desktop (read write; writes under /codex). The owner approves at http://localhost:3811/connect?code=NRRF-CTRR.` Clear.
5. /connect (step-1): summary "priya-mbp agent · can read and write, writes only in /codex · offered by priya-mbp agent", plus "priya-mbp agent sealed the drive key for this login; Agent Drive never sees it." The agent name appears three times in four lines and the summary does not name the drive; it reads as if priya-mbp agent is the one receiving access. Details row DRIVE shows "priya-mbp agent" (the drive is named after the first agent). Geometry clean; "Details" wrapped-control hit is a false positive.
6. Wrong verification code on the web (step-2/3): red inline text "This code does not match the one your agent printed. Check the terminal again and type it exactly." Friendly and recoverable; the field keeps the typed value. (Different tone from the CLI tamper warning.)
7. Correct code, Approve (step-4): "Access approved for codex-desktop. You approved codex-desktop to read and write the drive priya-mbp agent." "Open console" is the only button.
8. Codex terminal: `Logged in as agent codex-desktop.`, `Usable drives: <id>`, `Scopes: read write`, `Writes limited to: /codex`, `Config: ...`. Matches the story. `whoami` shows writePaths /codex. `check` -> `drive key not backed up` exit 1 (a granted agent holds a sealed key but cannot pass `check` until it backs up credentials; nothing in the grant or approval flow says so). put to /codex/h.md works; put to /notcodex/h.md: `The API key may only write under /codex.` Clear.
9. The trap (step-5/6): a second login (codex-trap) with no grant shows "New encrypted drive · full access" and the identical Approve button; nothing indicates a grant might still be coming, so approving early creates a new empty drive. Mobile 390x844: no overflow; the verification input is narrow beside its label and its placeholder is clipped ("a1b2 c3d4 e5f6").

Browser errors: none. Pending codex-trap login process (PID I started) killed.

## Flow Log

- Ideal 7. Needed 7 plus 1 forced backup export before `check` (8). Relaying two codes between agent and human is the unusual part and is well guided.
- Hesitations: summary wording on /connect; approve before or after the grant; alarming CLI mismatch text.
- Duplicated info: verification code (terminal, chat, grant command, web); agent name x3 on /connect.
