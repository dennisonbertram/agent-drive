# Agent Drive redundancy and information-architecture critique

Run date 2026-11-06. Evidence key: `signup/NN`, `first-run/NN`, `find/NN`, `download/NN`, `versions/NN`, `sharing/NN`, `second-agent/NN`, `abb/NN` = screenshot NN in `docs/ux-flow/journeys/{signup,first-run-setup,find-open-file,download-decrypt,versions-trash,sharing,second-agent,agents-keys-billing}-screens/`. `catalog` = `docs/ux-paths/catalog.md` (Redundancy Candidates and "Cloud-drive expectations vs. today"). Screenshots I opened myself while writing this: signup/10, abb/01, abb/08, find/07. Other screenshot claims come from the journey critiques that cite them; I did not re-open those images. Items that no screenshot or catalog entry supports are marked "unverified".

Counts: Duplicate Paths 8 · Duplicate Information 10 · Overlapping Features 6 · Hierarchy & IA 10.

## Duplicate Paths

1. **Reaching sign-up.** The landing nav has "Sign in" and "Console", and neither is a sign-up button (signup/01). Pricing has "Start with Free" (signup/05). `/connect` signed out bounces to `/sign-in` with no mention of the pending code (signup/06). The sign-in and sign-up pages share no link to each other in the unconfigured state (signup/03, 04). Drift: five doors, none labelled "Sign up" on the main page. Recommend: one orange "Sign up free" on the landing header; drop "Console" while signed out. (catalog: Sign up)
2. **Getting a first drive or agent.** In one console view there are "+ New drive" (top right), "Create your first drive" (first visit, signup/07), the dashed "YOUR NEXT AGENT" tile in the drive strip that adds a drive (signup/10), "Connect an agent" in the empty Files state (signup/10), and a "Connect an agent" bar on the Agents tab (abb/01). They lead to different outcomes (some produce a drive key, some do not; catalog). Drift. Recommend: one primary "Connect an agent" and one secondary "New drive"; one tile name.
3. **Giving a second agent access.** Three routes: browser "Add to an existing drive" (6 owner steps, owner handles the recovery file), `grant` (2 owner steps, no secret), `credentials issue` (0 owner steps, no approval) (second-agent scorecard, screens 01, 02, 06). Different human involvement, so deliberate, but the choice is explained nowhere (second-agent Clarity Issues). Recommend: keep all three, explain once; make route A's drive selector visible on first screen.
4. **Restoring a file.** Trash tab "Restore" and the Versions dialog "Restore this version" produce the same outcome (versions/03, 06). Deliberate (undelete vs roll back), but the Versions dialog reached from Trash showed different state than from Files (versions-trash functional note a; suspected, not reproduced). Recommend: keep both; same toast wording and "Show file" link.
5. **Revoking access.** Agents tab "Revoke access" kills all of an agent's keys; API keys tab "Revoke" kills one (abb/01, abb/05). The Agents row keeps an enabled "Revoke access" at "0 ACTIVE KEYS" (abb/01, old-laptop). Drift in naming, not in capability. Recommend: label the buttons by scope ("Revoke trace-a", "Revoke key").
6. **Loading the drive key.** The console offers a paste field, a recovery-file chooser that does not submit, and a credentials bundle (`adcred1.`) (download/05, 06; catalog Load the drive key). Three inputs, one result. Recommend: file first, auto-submit on selection.
7. **Finding a file / seeing what changed.** Console filter (path text, loaded rows only), CLI `search`/`ls`, MCP `list`/`search`, and `recent` (find/03; catalog Cloud-drive table). The console is the weakest surface. "What changed recently" has no console answer (find Scorecard). Drift, not deliberate. Recommend: promote `recent` and server-side search into the console, or stop calling the filter search.
8. **Seeing plan usage.** Usage tab (no allowance), Billing (allowance "5.0 GiB included"), Pricing (limits again) (abb/07, 08, 09). Three screens for one question. Recommend: put "9.4 KiB of 5 GiB" on Usage and a bar in the sidebar; Billing holds plan change and spend caps.

## Duplicate Information

1. **Storage used.** Usage shows "9.5 KB" (abb/07); Billing shows "9.4 KiB" (abb/08). Different units for one quantity, and the allowance is only on Billing. Recommend: one unit (KiB/GiB), one figure, allowance next to it.
2. **Usage per agent.** Usage tab "Usage by author" (abb/07) and Billing "Usage by agent" with CSV (abb/08, which I opened: the table lists 11 rows including Console). Same breakdown, two titles. Recommend: one table, one name, on Usage; keep CSV beside it.
3. **Plans.** Billing plan cards (abb/08) repeat the public Pricing page with different wording ("stored ciphertext" vs "encrypted storage"; "API operations" vs "operations") (abb/09). Recommend: one component.
4. **Key state.** "KEY LOADED"/"KEY REQUIRED" badge, a button label (Load drive key/Forget key), and the backup banner state the same key situation in three places, and red dots mean both good and bad (download/07; find/07 which I opened shows a red dot on both the backup line and KEY LOADED). Also signup/10 shows "This drive's key hasn't been backed up" immediately after the user saved the key. Recommend: one status chip, green/red meaning fixed.
5. **Drive ID.** A truncated ID with a Copy button sits in the file panel header on every drive view (signup/10 "bcd55cac…", find/07 "63e2243b…"). Nothing in any journey uses it. (catalog Drive ID.) Recommend: move into a drive details menu.
6. **Sign in / Console.** Two nav links to the same sign-in when signed out (signup/01, 03, 06); nav says "Console" on landing but "Open console" on Pricing (signup/05).
7. **Agent id.** The full UUID is printed on every Agents row (abb/01, which I opened) and on every Versions row (versions/03). It is used by no story step except CLI work. Recommend: show on hover or inside a details view.
8. **Counts that look alike.** "9 AGENTS" and "7 ACTIVE KEYS" sit on adjacent tabs and count different things (abb Clarity Issues).
9. **Author.** After a restore the AUTHOR column reads "Console", replacing the original writer (find/07 which I opened; versions/04, 09). The same row shows "research-bot" in Versions (find/04-versions). The list and the history disagree.
10. **Page title echo.** Trash repeats "Deleted files / research-bot" under the "Trash" title and drive pill (versions/06). Also the hero line "A home for the work. A starting point for what's next." sits under "Drives & files" and again nowhere useful (signup/10, find/07).

## Overlapping Features

1. **Agents tab and API keys tab.** Agent identity and keys live in two tabs with overlapping revoke actions; "issued by" shows on both; neither shows drives or write path (abb/01, abb/05; second-agent/07, 08; catalog). Merge into one agent table with keys inside the row.
2. **Trash tab and Versions dialog.** Both restore; Versions is reachable from Files and Trash (versions/03, 06; catalog). Keep both surfaces, share one restore notice.
3. **Usage tab and Billing page.** Usage has storage, operations and "EGRESS & COST" with no figures (abb/07); Billing has the same figures plus plan and caps (abb/08). Billing is a full-page layout with "Back to files" and "Settings", unlike every tab (abb/08). Merge or clearly split (use vs pay).
4. **Activity sources.** Audit log (Activity & deletion), Usage by author, Versions author column, Trash DELETED column, CLI `recent` each answer part of "what happened" (sharing/03 shows an audit log mostly of the console's own `drives.list` calls; find Dead ends; catalog). Candidate for one Activity view.
5. **Pricing page and Billing plan cards.** Same three plans rendered twice (abb/08, 09; catalog).
6. **Activity & deletion page.** Combines an audit log with destructive account actions, two unrelated jobs (sharing/03; catalog Overlapping). Split.

## Hierarchy & IA

1. **Drive vs workspace.** The same container is "drive" (strip, dialog, "+ New drive"), "Personal workspace / OPERATOR CONSOLE" (sidebar header, signup/10), "Workspace / Files" (breadcrumb), "Create your workspace" (sign-up title, signup/04), "YOUR WORKSPACE" (Billing, abb/08), and "Drives & files" (page title). Pick "drive" for the encrypted store and drop "workspace" except for the account.
2. **Drive vs agent.** The dashed tile in the drive strip says "YOUR NEXT AGENT" but creates a drive (signup/10, abb/01); the first-run drive is named `claude-code`, the same as the agent (first-run/03, 04). A newcomer cannot tell which is which.
3. **Author vs agent.** "AUTHOR" in Files, "Usage by author" (abb/07), "Usage by agent" (abb/08), and "Console" appears as an author in the usage table (abb/08). One concept, three names.
4. **Key vocabulary.** "Drive key", "recovery key", "recovery file", "credentials bundle", "credentials export" (signup/09, 10; second-agent/02) for one secret, plus "API key" for a different one, and "pairing code/code/link/approve/connect/login" for one step (first-run Clarity Issues).
5. **Storage naming.** "Encrypted storage" (abb/07), "Retained storage" (abb/08), "stored ciphertext" (abb/09), with KB vs KiB.
6. **Revoke.** One verb, two scopes (see Duplicate Paths 5); native `confirm()` dialogs name the agent but the button does not (abb Friction notes). Recommend: button names its target.
7. **Sidebar order and weight.** First-time users see 7 items (Files, Agents, API keys, Usage, Trash, Billing, Activity) of which six are empty (signup/07, 10). Usage, Billing and Activity are admin pages at the same level as Files. Recommend: Files, Agents, Trash at top; Usage and Billing under an account area.
8. **Missing top-level jobs.** Upload, Share, Recents, search, folders, rename, preview are not in the console (catalog Cloud-drive table; sharing/01; find/02; signup/10 empty state says upload is CLI-only). The primary orange button is "+ New drive" where a Dropbox user expects Upload/New (signup/10).
9. **Drive strip appears on tabs where it does not apply.** The drive tab strip shows on Agents (abb/01), where agents are account-level.
10. **Default drive and colour.** Console opens on the alphabetically first drive "nightly-builds", not the 25-file drive (find Scorecard; abb/01 shows it selected); the same default sets the wrong drive in the Add-to-existing form (second-agent trap, screen 02). Red is used for both good ("Key backed up", KEY LOADED) and bad states (find/07, download/07).

Mobile (signup/11, 12; abb/10): the landing page hides all header navigation at 390 px, so there is no Sign in or Sign up above the fold (signup/12; critique DOM check). The mobile console works.
