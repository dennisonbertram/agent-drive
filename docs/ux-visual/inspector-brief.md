# Inspector brief (Phase 2)

You are a ruthless senior product designer and a first-time user at once, auditing one page group of Agent Drive after the T1 "Rack" redesign. Accept nothing less than excellent; no excuses. Do not edit app code.

Read first: /Users/dennison/.claude/skills/ux-visual/references/visual-heuristics.md, docs/ux-visual/inventory.md (server, sign-in, states, viewports), docs/design/t1-rack-reference.html (the approved look — consistency with it is a norm), docs/design/t1-rollout.md (rules). Repo: /Users/dennison/develop/agent-drive-t1.

For EVERY viewport × state in your scope:

1. Capture with `agent-browser --session ux-visual-<slug> ...` (never npx, never the default session): set viewport, reach the state, wait for a known element + fonts (cap ~15s), take viewport and full-page screenshots into docs/ux-visual/pages/<slug>/shots/<viewport>-<state>.png (+ -full.png). Open every screenshot with Read and look properly. Hide the Next dev-tools badge before capturing (e.g. eval `document.querySelector('nextjs-portal')?.remove()`), it is dev-only.
2. Measure: run `agent-browser --session ux-visual-<slug> eval "$(cat /Users/dennison/.claude/skills/ux-visual/references/layout-audit.js)"` and the same with `/Users/dennison/.claude/skills/ux-walker/references/geometry-audit.js`; append both JSON results to docs/ux-visual/pages/<slug>/audit.json keyed by viewport/state.
3. Interact like a human: hover, tab (focus order/visibility), click every non-destructive action, open every dialog/menu, type long text/emoji, resize between breakpoints, scroll every container, trigger errors. Note hesitations, surprises, layout shifts, dead ends.
4. Critique recursively: component → group → page → layout, and name the norm violated. Include cross-page consistency with the T1 reference and the rest of the app (brand mark, header, colours, type, buttons, LEDs, spacing). Known items to confirm or reject: old "a/ agent drive" brand mark, leftover lime/green colours, double rule under the pricing header.
5. Second opinions: write docs/ux-visual/pages/<slug>/brief.md (app purpose, page, persona, states, viewports), then run `node /Users/dennison/.claude/skills/ux-visual/references/second-opinion.mjs --mode inspect --brief docs/ux-visual/pages/<slug>/brief.md --out docs/ux-visual/pages/<slug>/second-opinion.json <up to 8 screenshots>` (OPENROUTER_API_KEY is set). Verify each external claim against the screenshot/live page before accepting; attribute [own]/[muse]/[argon].
6. Severity: P0 blocks/misleads; P1 a human would stumble; P2 visibly below excellent; P3 polish.

Honesty: every finding cites a screenshot path and/or audit.json metric and the norm; mark measured/observed/suspected. Praise what is excellent.

Write docs/ux-visual/pages/<slug>/findings.md: per viewport×state verdict + refs; findings table (id <SLUG>-NN | level | element | problem | norm | evidence | severity | found by | verified); "Excellent as is" list; for each finding, the likely file/selector to fix (apps/web/app/globals.css or apps/web/app/styles/\*.css or the TSX).
Do not commit. Return: counts by severity and level, and the 5 worst findings in one line each.
