# Prod public setup pages - findings (https://agentdrive.xyz, signed out, read-only)

Session uxv-prod. Viewports 1440x900, 1280x800, 768x1024, 375x812. Screenshots in `shots/` (`<page>-<width>.png` full page, `-fold.png` first screen). Audits (layout-audit.js + geometry-audit.js) for 7 pages x 4 viewports in `audit.json`. I opened the 1440 and 375 folds and the 1440 landing full page; the 1280 and 768 shots were audited by script (no horizontal overflow, pageScrollX 0 everywhere) but not individually viewed. No forms were typed into or submitted, nothing downloaded. Cookie banner: none seen on any page (no consent UI to decline; observed). Text claims were also checked against the published `.md` pages via curl.

## Verdicts
- **Landing, setup path obvious?** Mostly yes. The hero has one dark "Give this to your agent" block with a Copy prompt button and the line "Free to start. Your agent shows a pairing code, and you approve it in your account." That says what happens next. Weakness: there are three competing entry points in the first 900px (nav "Sign up free", Copy prompt, "npm install" Copy command), and the Copy prompt button is a white outline button inside a dark box while the only filled orange button is "Sign up free", which is not the first step (the agent step is). Evidence: `shots/landing-1440-fold.png`.
- **Docs read as a setup sequence?** Quickstart: yes, excellent. Numbered "1. Sign up / 2. Install the CLI / 3. Log in and approve" with "Run the steps in order as a checklist." (`shots/quickstart-1440-fold.png`). The /docs index lists "Get started" first but as four equal links in alphabet-free but unranked order, with no "start here" marker. Connect-an-agent opens with a dense explanation paragraph before the command (`shots/connect-1440-fold.png`).
- **Finder/desktop option discoverable?** No. The landing page body (`/index.md`) has no mention of Finder, desktop or mount; /docs index, the sidebar and quickstart do not mention it either. The only mention is one long paragraph in /docs/cli ("Download Agent Drive Finder 0.3.1 ... drag it to /Applications", `shots/cli-1440-fold.png`), which a first-time visitor reaches only via CLI reference. Measured: that page is 19,286px of scroll at 1440 (audit.json).
- **Sign-up page:** clear and minimal (GitHub, Google, email, one orange Continue). Excellent as is, with one contrast nit.
- **Mobile:** no horizontal scroll at any viewport; hero CTA stays above the fold at 375 (`shots/landing-375-fold.png`).

## Findings
| id | level | element | problem | norm | evidence | severity | measured/observed |
|---|---|---|---|---|---|---|---|
| PP1 | page | Finder/desktop option | The macOS Finder app is mentioned nowhere a first-time visitor reads: not landing, /docs index, sidebar, quickstart or connect. Only a dense paragraph inside CLI reference. | I6, C1, H5 | `shots/cli-1440-fold.png`; curl of index.md, docs/quickstart.md, docs/connect-an-agent.md found no "Finder" | P1 | observed (grep + screenshots) |
| PP2 | component | Landing hero CTAs | Primary emphasis is on nav "Sign up free" (only filled orange button) while the hero's real first step, "Copy prompt", is an outline button; plus a second command with its own Copy button. Three entry points before the fold. | H1, H2, I5 | `shots/landing-1440-fold.png` | P2 | observed |
| PP3 | component | CLI reference Finder paragraph | One ~9-line paragraph mixes Linux FUSE helper, macOS version, app download, build workflow and source-build links. The download link is buried mid-paragraph. | C1, D1 (45-80ch measure; line is ~130ch wide) | `shots/cli-1440-fold.png` | P2 | observed |
| PP4 | page | /docs/cli length | 19,286px page height at 1440 and 32,146px at 375; very long reference with no on-page contents visible in the fold. | L7, I6 | audit.json cli 1440x900 `pageScrollY` 19286; cli 375x812 32146 | P3 | measured |
| PP5 | component | /docs index "Get started" | Four equal links with no order or "start here" on Quickstart; the sidebar likewise. Quickstart itself is clear but the index does not signal it is step one. | H1, I6 | `shots/docs-1440-fold.png` | P2 | observed |
| PP6 | component | Connect-an-agent opening | The first screen is a long explanatory paragraph on the device flow; the command ("Log in") starts below the fold at 1440x900. | L2, H2 | `shots/connect-1440-fold.png` (command cut at y~870) | P3 | observed |
| PP7 | component | Quickstart step 1 | "Create your account at /sign-up." shows the raw path as link text instead of a verb phrase. | C1 | `shots/quickstart-1440-fold.png` | P3 | observed |
| PP8 | component | Link targets in docs | layout-audit flags docs inline/sidebar links 15-23px tall (e.g. "Quickstart" 53x15, "View as Markdown" 115x16, sidebar links 19px high). Footer "CLI" link is 21x44 at 1440 and 23x44 at 375. | I4 | audit.json (quickstart/connect, smallTargets) | P3 | measured |
| PP9 | component | Landing pricing "Choose plan" links | Links measured 14px tall at 1440 and 375. | I4 | audit.json landing smallTargets | P3 | measured |
| PP10 | component | Sign-up footer "Sign in" (Clerk) | Contrast ratio 3.36:1 for small orange text; also duplicate "Already have an account? Sign in" appears twice in the card/footer. | A1, C2 | audit.json signup lowContrast 3.36; `shots/signup-1440-fold.png` | P3 | measured / observed |
| PP11 | component | /llms.txt rendering | Plain monospace text (right for agents). The setup guide starts after ~35 lines of doc index, so a human who clicks the landing URL sees a link list first. The setup text (Instruction a human gives you ... "Set up (local agent with a shell)") is below the fold. | C1, L2 | `shots/llms-1440-fold.png` | P3 | observed |

Not findings: geometry-audit `unevenRows` (nav, footer) and `wrappedControls` are zero-impact in the screenshots (nav item widths differ only by label length). Spacing off-scale 10/14px values on landing (audit.json) are measured but invisible; not worth action.

## Excellent as is
- Quickstart numbered checklist with copy-ready code blocks and an npx fallback (`shots/quickstart-1440-fold.png`).
- Sign-up page: one task, one orange button (`shots/signup-1440-fold.png`).
- Pricing: three plans, one primary "Start with Free", no horizontal overflow (`shots/pricing-1440-fold.png`).
- No horizontal overflow at any of 4 viewports on any page (audit.json pageScrollX 0 / pageOverflowX 0).
- Landing hero copy states the next step ("shows a pairing code, and you approve it in your account").
- llms.txt content is a complete, ordered agent setup guide (install, connect, approve, back up, check).
