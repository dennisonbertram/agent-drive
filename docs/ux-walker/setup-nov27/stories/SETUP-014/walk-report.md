# SETUP-014 walk report: reading llms.txt directly in a browser

Session uxw-install-login-solo, signed out. Server on http://localhost:3811 (so all URLs in the document are localhost, and every command carries `--api http://localhost:3811/api`, expected for a non-public origin).

## Steps

1. `/llms.txt` in the browser (step-1.png): plain text (content-type text/plain; charset=utf-8), starts "# Agent Drive", "> Encrypted file storage for agents..." and "The setup guide follows the lists." then Docs (Get started, Guides, Reference, Security) and Pages lists. LOOK: unstyled monospace text, long lines run the full 1280 px width; URLs are plain text, not clickable. No errors in the browser console.
2. Scrolled to "## Set up (local agent with a shell)" (step-2.png): it begins at line 63, about 925 px down a 3671 px page, i.e. the thing Devon came to read (what the agent will do) is below ~60 lines of link lists. Steps 1 to 6 are numbered. Step 4 gives the three backup options in order; step 6 says "Setup is complete only when it prints `check ok`." Step 2 says "Other options on the page are optional; the defaults are right." which a human reader cannot match to anything. Step 3 ("The human approves (step 2). Wait for the command to finish.") repeats step 2.
3. Docs home (`/docs`, step-3.png) has a link "Agent setup guide" to /llms.txt and "All docs in one file" to /llms-full.txt; the home page footer/links also carry "Agent setup guide". The console Agents panel carries "Read what your agent will see (llms.txt)". The header (Pricing, Docs, Sign in, Sign up free) has no llms.txt link.
4. Markdown twins: /index.md, /pricing.md, /compare.md, /docs/quickstart.md all 200. `/cli/agent-drive.tgz` returns 404, and no served doc mentions it (the stale claim in docs/agent-login.md is not published here).
5. Quickstart (served doc) step 3 says "check that the code matches the one in the terminal, and click Approve" and omits the verification code that llms.txt and connect-an-agent.md require (confirmed discrepancy).
6. Mobile 390x844 (mobile-check.png): text wraps, scrollWidth 390 (no horizontal overflow); long link lines wrap into narrow columns but stay readable.

## Flow Log

- Ideal 2 steps (open /llms.txt, scroll to setup). Actual: open, scroll about one screen (3 on mobile), read. Met, though the key section sits after the index.
- Hesitation: finding the setup section; "Other options on the page are optional" is unclear for a human. Duplicate: steps 2/3 overlap; quickstart vs llms.txt differ on the verification code.
- Not walkable: the "Hosted assistants" behavior with a real chat assistant.
