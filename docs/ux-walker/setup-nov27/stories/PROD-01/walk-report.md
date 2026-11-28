# Walk report PROD-01: Landing page and hero calls to action

Story reference: SETUP-001, SETUP-009 (first steps). Target: https://agentdrive.xyz release 0.5.1, signed out, viewport 1280x800 plus one 390x844 check. Session uxw-prod-public.

Status: partial. Landing and hero Copy prompt work and show 'Copied' feedback; npm name matches docs. Gaps: pairing-code wording (F-PROD-01-2), no Node 24 note (F-PROD-01-6), inconsistent copy buttons (F-PROD-01-7).

## Steps

1. Action: Open https://agentdrive.xyz at 1280x800
   Screenshot: step-1.png
   Shows: Hero 'Agent files that outlive the sandbox.' with dark panel 'Give this to your agent', Copy prompt, 'or in a terminal:' npm command with COPY COMMAND, header Pricing/Docs/Sign in/Sign up free. Primary action clear. Geometry: pageOverflowX 0, no spills; the 'unevenRows' hits are the three nav links and footer, intentional, and 'wrappedControls' hits were not wrapped in the screenshot (false positives). Console/errors: none.

2. Action: Click Copy prompt
   Screenshot: step-2.png
   Shows: Button changes to 'Copied' and a status region announces it. Hero illustration advances (animated). Clean.

3. Action: Scroll the landing page
   Screenshot: step-3.png
   Shows: Problem section with three flow rows renders evenly. Page has no further sign-up route except header and closing sections. Plan table, FAQ, comparisons and footer links read via snapshot (Docs, Quickstart, CLI, MCP tools, HTTP API, Agent setup guide, npm package).

4. Action: Mobile 390x844
   Screenshot: step-4-mobile.png, step-5-mobile-top.png
   Shows: Header collapses to Menu plus Sign up free; hero panel and copy buttons usable; scrollWidth minus innerWidth 0. Clean.

## Findings

- F-PROD-01-2 (medium): Hero and quickstart describe the pairing step differently from llms.txt and Connect an agent. Hero says 'Your agent shows a pairing code, and you approve it'; quickstart step 3 says 'check that the code matches ... and click Approve'. llms.txt and /docs/connect-an-agent require typing a separate 'Verification code' into the page.
- F-PROD-01-6 (low): The hero terminal option shows `npm install -g @dennisonbertram/agent-drive` with no Node 24 requirement and no next command (`agent-drive login`). Node 24 is stated only in quickstart, llms.txt and the CLI docs.
- F-PROD-01-7 (low): The two hero copy controls look unrelated: 'Copy prompt' is a sentence-case white outlined button inside the dark panel, 'COPY COMMAND' is a small uppercase monospace outlined box beside the command.

## Flow Log

3 minimum (read hero, Copy prompt, paste); 3 needed and walked. Hesitations: hint says 'a pairing code' only; a terminal user is not told Node 24 or that `agent-drive login` comes next. Duplicated info: the setup line appears twice (hero, closing) by design; plan facts appear on landing and /pricing and disagree (F-PROD-01-1).
