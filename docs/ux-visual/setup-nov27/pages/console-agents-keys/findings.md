# Console: Agents tab, API keys tab, /console/settings (Activity & deletion)

Release 0.5.1 local copy, http://localhost:3811, fresh user e2e_vis_console_agents_keys_1. Shots: `shots/` (state-viewport-view|full.png). Raw audits: `audit.json` (layout-audit + geometry-audit per state x viewport).

Method caveats (read first)
- Another agent wrote its own `ab.sh` into the shared scratchpad, so for a while my `agent-browser` calls drove another session and my session reloaded/blanked. I moved my scripts to a private folder and re-did every capture that looked wrong. `agents-empty-*` and `agents-codex-snippet-*` were captured before that, from a clean zero-agent account (content matches). They cannot be re-taken because the account now has an agent. I may have sent a few stray keypresses (Escape/Enter) to the other session; none destructive.
- Sessions were reaped between calls, so I re-logged in each time. Server data persisted.
- The Next.js dev badge overlapping the sidebar footer and some text is dev-only and excluded.
- Never deleted anything: delete-drive/account buttons stayed disabled. Test API key appears in `key-secret-dialog-*` shots (throwaway local key).

## Verdict per viewport x state
| State | 1440x900 | 1280x800 | 768x1024 | 375x812 |
|---|---|---|---|---|
| Agents empty | Good, compact; 2 primary CTAs (F4) | same; connect text measure ~1100px (F18) | subtitle truncated (F7) | good; command wraps mid-token (F21) |
| Agents + Codex snippet | FAIL: Copy invisible (F1) | FAIL F1 | FAIL F1 | FAIL F1 |
| One agent | Good; collapsed Connect bar unclear (F5), no key action (F13) | same | name wraps to 5 lines, OK | stacks cleanly, OK |
| Agent revoke dialog | Excellent copy; all-caps title (F9) | same | same | buttons stack, title 5 lines (F9) |
| Keys, no drive (after agent create) | FAIL: contradictory message + silent disabled button (F2) | FAIL | notice truncated (F7) | notice becomes fixed bar over content (F8) |
| Keys empty | Good; 2 primary CTAs (F4), docs panel outweighs task (F11) | page runs past fold (F26) | subtitle truncated (F7) | OK |
| Create API key dialog | Good, fits | good | good | fits; 16px checkboxes (F17) |
| Save-secret dialog | Excellent | excellent | excellent | excellent |
| One key | Good; row lacks identifying detail (F12) | same | ok | Active badge floats mid-row, Revoke on own row; acceptable |
| Key revoke dialog | Safe defaults; title unreadable (F9) | same | same | ok |
| Settings (activity + delete) | Heavy hero H1, misaligned delete grid (F14, F15) | same | same, single column ok | nav label "Billing" truncated (F25); table stacks without headers |

## Findings
| id | level | element | problem | norm | evidence | severity | measured/observed |
|---|---|---|---|---|---|---|---|
| F1 | P1 | MCP setup Copy buttons (Claude Code, Codex, Cursor) | Copy button is white text on transparent background, sitting below the dark code block on a white panel. Invisible; only way to copy the config is hidden. Looks like 40px of empty space under the snippet. | A1 contrast 1:1, I1 affordance, I8 | `shots/agents-codex-snippet-1440-view.png`; computed color rgb(255,255,255), bg rgba(0,0,0,0), box 273,462 49x28; layout-audit lowContrast ratio 1 for all three in `audit.json` | P1 | measured + observed (annotated screenshot showed empty box @e159) |
| F2 | P1 | Post "New agent" flow, API keys tab | Notice says "Agent created. Create an API key to connect it." but the tab says "Create a drive first." and "+ New API key" is disabled with no reason. A new user is told to do something the page blocks. Agents can be created with no drive. | C1/C3 misleading state, I8 disabled with reason, I3 | `shots/keys-no-drive-1280-view.png`, `keys-no-drive-768-view.png` | P1 | observed |
| F3 | P2 | "Create drive" from API keys empty state | After the recovery-file step the app lands on Files, not back on API keys. Quote: "Workspace / Files ... Recovery file saved". User must re-find the key button. | I6, P1 task continuity | `shots/drive-created-1440-view.png` then step output (main text started "Workspace / Files") | P2 | observed |
| F4 | P2 | Agents + API keys empty states | Two high-emphasis orange buttons in one view for the same action: "+ New agent" and "Create your first agent"; "+ New API key" and "Create API key". | H1 | `shots/agents-empty-1440-view.png`, `shots/keys-empty-1280-view.png` | P2 | observed |
| F5 | P2 | "Connect an agent" panel when collapsed | Renders as an empty bordered bar, no chevron or marker; looks like a dead card. When open on Agents it is a heading with no marker either. | I1, I6 | `shots/agents-one-agent-1440-view.png`, `keys-empty-1280-view.png` | P2 | observed |
| F6 | P2 | Tab state | Tab is not in the URL (/console always). Crossing the 375 to 1440 breakpoint resets to Files and closes dialogs; during first load, a click on Agents made before "Opening your workspace" finished ended on Files. | L5, I6, I3 | h1 read "Files" after set viewport 1440 from 375 (several steps); `shots/` none (state loss) | P2 | observed |
| F7 | P2 | Header sub-text at 768 | "Separate identities. Purpose-built permi…" and "Agent created. Create an …" are clipped, hiding the instruction. | C4 | `shots/agents-empty-768-view.png`, `keys-no-drive-768-view.png` | P2 | observed |
| F8 | P2 | Notice at 375 | Notice turns into a fixed bar at the bottom covering the terminal block; inline in the header at 1280/1440. | L5, H5 | `shots/keys-no-drive-375-view.png` | P2 | observed |
| F9 | P2 | Revoke dialog titles | Title is tracked, all-caps mono with user data ("REVOKE RESEARCH LAPTOP FOR THE QUARTERLY PLANNING AGENT IN THE LISBON OFFICE?"), 2-5 lines; hard to read. | C1, H3 | `shots/agent-revoke-dialog-375-view.png`, `key-revoke-dialog-768-view.png` | P2 | observed |
| F10 | P2 | Dialog close | Escape closes the revoke dialog but focus goes to BODY, not back to the Revoke button. | I7 | eval: activeElement tagName BODY after Escape | P2 | measured |
| F11 | P2 | API keys terminal panel | Copy says "Run the CLI from the repository after building it", but users install via npm; jargon and wrong. The panel (340px) is taller than the key list (160px) and has no Copy button. | C1, H2, C2 | `shots/key-one-1440-view.png` | P2 | observed |
| F12 | P2 | Key row | Meta line is 11px grey mono with the agent name cut mid-word; no created date, last used or key prefix, so two keys cannot be told apart. | I6, D1 | `shots/key-one-1440-view.png`; missing fields suspected product gap | P2 | observed / suspected |
| F13 | P2 | Agent row | No "Create API key" action on an agent; the notice sends you to another tab. Only action is "Revoke access". | I5, L7 actions near object | `shots/agents-one-agent-1440-view.png` | P2 | observed |
| F14 | P2 | /console/settings shell | Different shell than the console (no sidebar, 1096px column vs 1160), 52px marketing H1 plus eyebrow "YOUR WORKSPACE, YOUR CONTROL" on a tool page. | H5, H3, D1, L4 | `shots/settings-activity-1440-view.png` | P2 | observed |
| F15 | P2 | Delete drive / delete account grid | Columns do not align: left has blank band above "Drive"; inputs at y~1363 vs ~1290, buttons ~1446 vs ~1373 (1440 full). | H6, L4, D2 | `shots/settings-activity-1440-full.png` | P2 | measured from screenshot |
| F16 | P2 | "Passphrase unlock" card | Off topic on "Activity & deletion"; 4px gap between "Not set up." and button. | C1, D4 | `shots/settings-activity-1440-view.png` | P2 | observed |
| F17 | P2 | Create-key checkboxes | 16x16 boxes, label row 19px high, on a touch viewport. | I4 | audit smallTargets in `audit.json` (key-create-dialog 375); `shots/key-create-dialog-375-view.png` | P2 | measured |
| F18 | P3 | Connect panel text | Paragraph runs ~1100px (~170ch) at 1440; copy box fixed 650px. | D1 | `shots/agents-empty-1440-view.png` | P3 | observed |
| F19 | P3 | Spacing | "Read what your agent will see" touches the divider; Connect inner padding 273 vs identities 267. | D3, L4 | `shots/agents-empty-1440-view.png` | P3 | observed |
| F20 | P3 | Small targets | llms link 225x16, notice Dismiss 47x15, settings links 80x21. | I4 | smallTargets in `audit.json` | P3 | measured |
| F21 | P3 | Code at 375 | Command breaks mid-token ("llms / .txt", drive id). | L6 polish | `shots/agents-empty-375-view.png` | P3 | observed |
| F22 | P3 | Empty-name submit | Browser-native "Please fill out this field." bubble, unbranded. | H5, I3 | scratchpad `na2.png` (not copied into shots) | P3 | observed |
| F23 | P3 | Activity table | Mixed fonts (When sans, What/Who/Result mono); Result "OK" grey, no icon. | H5, C3 | `shots/settings-activity-1440-view.png` | P3 | observed |
| F24 | P3 | Keyboard | No skip link: 8 tab stops (sidebar) before content. Order and 2px focus rings are otherwise good. | I7 | tab walk output | P3 | measured |
| F25 | P3 | Settings header 375 | "Billing & limits" shows as "Billing". | C4 | `shots/settings-activity-375-full.png` | P3 | observed |
| F26 | P3 | API keys at 1280x800 | Docs panel pushes content past the fold; list is first so primary is visible. | L1 | `shots/keys-empty-1280-full.png` | P3 | observed |

Counts: P0 0, P1 2, P2 15, P3 9 (26 total).

## Excellent as is
- Save-secret dialog: one-time warning, Copy focused, "I saved my API key securely" gates Done.
- Revoke dialogs: default focus Cancel, red only on the destructive button; agent version states consequences and what is kept ("Files this agent wrote stay in your drives.").
- Create-agent / create-key dialogs: short, autofocus, sensible defaults (read+write), "manage" labeled as sparing use. 128-char limit enforced.
- Delete buttons disabled with the reason written under them; nothing deletable by accident.
- No horizontal overflow at any viewport (pageOverflowX 0 in all audit rows), mobile nav as dropdown, dialogs fit at 375x812.
- Logical tab order, visible 2px focus rings.
