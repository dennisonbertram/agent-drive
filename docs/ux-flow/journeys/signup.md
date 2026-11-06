# Journey: signup (STORY-001 + STORY-003)

Screens: `signup-screens/` (01-12). Clerk is not configured locally, so the Clerk form itself was not seen. Post-sign-up console visit used fresh user `e2e_uxsignup11188` via test session (throwaway; created drive `my-first-drive`).

## Story
STORY-001 (landing -> sign up, ideal 2: one visible "Sign up" action, one form, land in console) and STORY-003 (brand-new account first visit, ideal 3: create drive, save key, continue; or skip the console and paste the agent line).

## Friction Scorecard
| Measure | Actual | Ideal | Evidence |
|---|---|---|---|
| Steps landing -> signed-in console | 3+ (Sign in or Console -> find the Clerk "sign up" link -> form -> console); not walkable locally | 2 | 01, 03; catalog STORY-001 |
| Visible "Sign up" on landing | none (nav: Docs, Pricing, llms.txt, Sign in, Console) | 1 | 01 |
| Steps first console visit -> drive exists, key saved | 5 (Create first drive, type name, Create, tick checkbox, Continue) | 3 | 07-10 |
| Decisions | drive name (no default); "Sign in" vs "Console" vs "Start with Free" | name defaulted | 08, 01, 05 |
| Confirmations | 1 forced checkbox "I saved my drive key securely" plus disabled Continue | 1 | 09 |
| Dead ends | local /sign-in and /sign-up say "Configure the Agent Drive Clerk instance" (expected here); first-run drive screen's "Connect an agent" jumps away (not measured here) | - | 03, 04, 10 |
| Hesitations (suspected) | Two competing first actions: "Create your first drive" vs pasting the agent line from the landing page; the console never mentions the agent line | - | 07 |
| Re-entry | Drive key is lost on reload: after reload the banner says key not backed up and the file area wants "Load drive key" | - | 10 |

Measured: counts above from the live traversal. Suspected: hesitations.

## Take-away Pass
- 01 Landing hero: strong, one primary action (Copy). But that action is for the agent, not a sign-up. Nav "Sign in" and "Console" are two links to the same place (03, 06); remove "Console" or make it "Open console" only when signed in. The architecture diagram, 3-row problem section and the example card add ~5000 px of page before any account prompt (02).
- 02 Landing, bottom: the final CTA repeats the Copy button, again with no sign-up button. A visitor who does not have an agent open has no next step.
- 03/04 Sign-in vs sign-up: titles differ ("Sign in" / "Create your workspace"), nothing links between them in the unconfigured state (as rendered here). Not judged for the Clerk-configured state.
- 05 Pricing: the only labelled path to an account ("Start with Free") is on a secondary page. The banner "Paid checkout is not enabled ..." is deployment-operator text shown to visitors. Nav here says "Open console" while the landing says "Console" (one concept, two names).
- 06 /connect?code= signed out: redirects to `/sign-in?redirect_url=...` with the same text and no mention of the pending code.
- 07 First console: clean and clear. The 01/02/03 strip ("Create a drive / Save your key / Connect an agent") is a good map but is not clickable. "+ New drive" (top right) and "Create your first drive" are the same action twice. Sidebar shows 7 items to a user with nothing yet (Agents, API keys, Usage, Trash, Billing, Activity are empty for them).
- 08 Dialog: one field, good. Placeholder "Research workspace" is a name suggestion that is not prefilled.
- 09 Key dialog: shows the raw key, Copy, "Save recovery key", warning, checkbox, Continue. Four actions for one decision; the checkbox is honest friction around an unrecoverable key.
- 10 Empty drive: red banner "This drive's key hasn't been backed up" appears immediately after the user just saved the key, saying it is about the agent's machine. This contradicts what they just did (the user's console key is not the agent's). "Connect an agent" is the right next step but is a secondary-weight outline button; the primary orange is "+ New drive".

## The Simpler Version
1. Landing: header gets one orange "Sign up free" button next to "Sign in" (drop "Console" while signed out). Final CTA gets "Create a free account" beside the Copy button.
2. Clerk form (not evaluated); keep `redirect_url`.
3. First console visit opens the Connect-an-agent panel by default ("Paste this to your agent": the llms.txt line + Copy) with "Create drive in the browser" as the secondary link. Most users arrive to connect an agent (the drive is created during /connect, per STORY-003 alternate path).
4. If they do create a drive: prefill the name ("my-drive"), and merge the key dialog into the creation result with one button "Download recovery file and continue" that counts as the save confirmation.
Concrete changes: (a) landing sign-up button; (b) first-run empty state leads with the agent line; (c) default drive name; (d) suppress the "key hasn't been backed up" banner for a drive created in the console whose key the user just saved; (e) make the 01/02/03 strip clickable or remove it.

## Clarity Issues
- "Give your first agent a home." is cute; "A little setup. A lasting workspace." (07) says little. Plain: "Connect your first agent."
- "Operator console", "Personal workspace" label (07) is jargon for someone with nothing in it.
- "Drives & files" subtitle "A home for the work. A starting point for what's next." (07) is filler.
- Key vocabulary: "drive key", "recovery key", "recovery file", "credentials export" all appear within 09/10 for roughly the same secret.
- Landing nav is hidden below desktop width: at 390 px there is no header link at all, so no Sign in or Sign up above the fold (12; DOM nav display none, width 0). Mobile visitor must scroll to the footer to reach Sign in.
- Mobile console (11) works: the sidebar becomes a "Files" dropdown, buttons wrap, banner is readable.
- Functional note: sign-up not testable locally (Clerk unset).

## Cloud-drive comparison
Dropbox/Google Drive: the landing page has "Sign up" as the primary button; the form is one screen (email/password or Google); after sign-up the user lands in an empty drive with Upload / New buttons and no key ceremony. Here the drive key is created and must be stored by the user before anything can be done (09), which has no cloud-drive equivalent; it is inherent to end-to-end encryption but can be made one click (download file). There is no upload in the console (empty state says "Connect an agent with the CLI or MCP", 10), so a Dropbox user's first instinct (drag a file in) has no target.

Verdict: acceptable (landing->sign-up path convoluted, first console visit is acceptable).
