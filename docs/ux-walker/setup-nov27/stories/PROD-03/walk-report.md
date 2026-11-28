# Walk report PROD-03: Docs, llms.txt and npm consistency

Story reference: SETUP-007, SETUP-009, SETUP-014. Target: https://agentdrive.xyz release 0.5.1, signed out, viewport 1280x800 plus one 390x844 check. Session uxw-prod-public.

Status: partial. Docs render cleanly and the npm package name and install command are identical on landing, quickstart, CLI docs, llms.txt and the npm registry (0.5.1, node >=24). Copy disagrees on the verification code step (F-PROD-01-2), quickstart wording (F-PROD-01-3), llms.txt ordering (F-PROD-01-10).

## Steps

1. Action: Open /docs
   Screenshot: step-1-docs.png
   Shows: Docs index with sidebar; sections Get started, Guides, Reference, Security, For agents. No Finder, desktop or mount entry. Clean.

2. Action: Quickstart
   Screenshot: step-2-quickstart.png
   Shows: Seven-step checklist. Step 1 Sign up, step 2 Node 24 and npm command, npx fallback. Step 3 omits the verification code.

3. Action: Connect an agent
   Screenshot: step-3-connect-an-agent.png
   Shows: Explains device flow including typing the verification code; 10-minute expiry; troubleshooting table. Clear and the most accurate source.

4. Action: CLI reference
   Screenshot: step-4-cli.png
   Shows: Install and configuration matches; macOS app paragraph is dense.

5. Action: Capture traces
   Screenshot: step-5-trace-capture.png
   Shows: Guide describes CLI capture and OpenRouter webhook; path/tag conventions; reads fine. Not run.

6. Action: Open /llms.txt
   Screenshot: step-6-llms.png
   Shows: Plain text, docs index first, then '## Set up (local agent with a shell)' with install, login, backup, skill, check. Consistent commands.

7. Action: Quickstart at 390px
   Screenshot: step-7-quickstart-mobile.png
   Shows: Docs menu select replaces sidebar; no overflow (0). Clean.

## Findings

- F-PROD-01-3 (low): Quickstart step 4 is written to the agent, not the human reader ('Offer these choices in this order and let the person pick one'), on a page whose intro says 'This page walks you through'. Step 1 'Sign up' also conflicts with the agent path in llms.txt, where sign-up is not a step.
- F-PROD-01-10 (suggestion): 'Agent setup guide' (footer, docs index 'For agents') opens /llms.txt as plain monospace text that starts with a 50-line docs index; the setup steps start further down. A human following that link to understand setup sees a link list first.

## Flow Log

Sandboxes page text was fetched but its screenshot timed out (browser was slow, other Chrome instances running); text read, not visually audited. Re-entry: a reader of quickstart then llms.txt meets a different step 3. npm check: `npm view @dennisonbertram/agent-drive` showed version 0.5.1, engines node >=24.0.0, matching docs.
