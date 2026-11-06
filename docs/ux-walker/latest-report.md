# UX Walker Report - 2026-11-06

## Run Summary

| Metric              | Value                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Target URL          | http://localhost:3500                                                                                                              |
| Run mode            | Focused: 27 core stories (sign-up, setup, drive, download, versions/trash, sharing, agents, keys, billing), three parallel lanes   |
| Stories in catalog  | 97                                                                                                                                 |
| Stories walked      | 27                                                                                                                                 |
| Stories skipped     | 70 (not in this run's core set; no prior history)                                                                                  |
| Stories re-verified | 0                                                                                                                                  |
| Overall pass rate   | 22/27 (81%)                                                                                                                        |
| Duration            | TBD (not recorded)                                                                                                                 |
| Mode                | Report only. No quick fixes were applied and no GitHub issues were filed. The /ux-auto-improve rounds will implement the findings. |

Counts below were recomputed from the 27 `findings.json` files, not taken from the lane reports (which miscounted). Directories for STORY-004, 008, 032, 033, 034 and 088 also exist under `stories/` but are not part of this run's plan and are not counted.

## Findings Summary

### By Severity

| Severity   | Count   | Quick Fixed | Issue Filed | Deferred |
| ---------- | ------- | ----------- | ----------- | -------- |
| Critical   | 0       | 0           | 0           | 0        |
| High       | 6       | 0           | 0           | 6        |
| Medium     | 37      | 0           | 0           | 37       |
| Low        | 57      | 0           | 0           | 57       |
| Suggestion | 7       | -           | -           | 7        |
| **Total**  | **107** | **0**       | **0**       | **107**  |

High findings: F-001-02 (landing nav missing on phones), F-019-01 (no folder browsing), F-022-01 (no Recent view or sort), F-024-01 (saving recovery file does not clear the backup banner), F-STORY-046-01 (no human share-link UI), F-STORY-065-01 (no Rotate key action).

### By Category

| Category       | Count | Examples                                                                    |
| -------------- | ----- | --------------------------------------------------------------------------- |
| Flow           | 26    | Selected drive/tab not in URL; Connect-an-agent path takes about 12 actions |
| Error Handling | 17    | Trash gives no warning that share links die; revoke notice off-screen       |
| Happy Path     | 14    | No folders, no Recent view, no human share UI                               |
| Consistency    | 13    | Usage vs Billing disagree (KB vs KiB, names); header nav differs by page    |
| Hierarchy      | 9     | Permissions in a run-on grey sentence; "Approved" shown three times         |
| Layout         | 8     | Mobile header nav has zero width; truncated Trash columns                   |
| Visual         | 8     | Healthy "Key backed up" status uses a red/orange dot                        |
| Simplicity     | 5     | Audit log and API operations dominated by the console's own reads           |
| Disclosure     | 4     | llms.txt says nothing for the human to choose; connect card collapsed       |
| Accessibility  | 3     | 13px default-blue checkbox; "Revoke access" buttons not distinguishable     |

## Quick Fixes Applied

None. This run was report only.

## Issues Filed

None. This run was report only.

## UX Audit Summary

### Systemic Issues

One entry per defect that appears in more than one story.

1. **The console cannot be browsed like a cloud drive.** No folder rows, tree or breadcrumb; no Recent view; no sort (MODIFIED header is inert); filter searches only the loaded 100 rows and only the path; Files badge (100) disagrees with the real total (114). Stories: 017, 019, 022 (findings F-017-01/02, F-019-01/02, F-022-01, F-049-03). Highest priority for the Dropbox-like goal.
2. **List and view state is lost.** Selected drive and tab are not in the URL, reload forgets them, the filter hides a just-restored file, the Trash filter message implies more matches, tabs keep the previous scroll offset. Stories: 018, 049, 050, 062 (F-018-02, F-050-01, F-049-03, F-STORY-062-03).
3. **Backup-key status is confusing and wrong in places.** A healthy "Key backed up" line uses the same red/orange dot as warnings; saving the recovery file at the receipt does not clear the banner; the banner contradicts the checkbox the user just ticked; it stays red until Refresh; the banner text clips exactly where the command is; status appears twice (banner plus chip); the Trash tab asks for a key it does not need. Stories: 002, 003, 017, 018, 024, 029, 046, 049 (F-002-03, F-017-03, F-029-03, F-024-01, F-003-02, F-029-02, F-029-04, F-STORY-046-05, F-049-04).
4. **The console's own reads pollute the audit log and usage numbers.** The first audit rows and 77% of API operations (477 of 619) are the owner's page views, which buries agent activity. Stories: 007, 022, 046, 072 (F-007-04, F-022-02, F-STORY-046-03, F-STORY-072-03).
5. **Revoke feedback and labelling.** The success notice is in the page header and scrolls out of view; every button is just "Revoke access" or "Revoke"; confirmation is a native `window.confirm`; Revoke stays enabled on agents with 0 keys; agent-level versus key-level revoke is unclear. Stories: 056, 062, 065, 066 (F-STORY-062-01/02/04, F-STORY-065-05, F-STORY-066-01/02/04, F-STORY-056-05).
6. **The /connect page.** The Approved screen is a dead end (no link to console or agent) and repeats "Approved" three times; the delegate checkbox is tiny, default blue, not marked optional, and its hint sits 2-11px above the Approve button; llms.txt says the human has nothing to choose while the page shows options; validation errors appear 450px from the field; the stale page does not update when an offer arrives. Stories: 006, 009, 010, 012, 056, 057 (F-006-01/02/03, F-009-01/03, F-012-01/02/03, F-STORY-056-03/04/07, F-STORY-057-01/02).
7. **Settings, Billing and Activity leave the console shell.** They use a different header, no sidebar, no account menu or sign-out, and different names for the same pages. Stories: 007, 046, 072 (F-007-01/02, F-STORY-046-04, F-STORY-072-02).
8. **Dead ends outside a configured Clerk (partly environment-caused).** Sign-in, sign-up and pricing states have no links onward; paid plans are disabled buttons with no waitlist or contact; operator wording is shown to prospects. Stories: 001, 010, 073 (F-001-03, F-STORY-073-01/02/03). Verify with Clerk configured before treating all of it as a product defect.
9. **Connecting an agent is longer than it needs to be.** The onboarding card offers only "Create your first drive"; "Connect an agent" leads to a disabled "+ New API key"; the paste-line panel is repeated on two tabs; the connect card is collapsed with no chevron; adding an agent to an existing drive requires re-entering a key the console may already hold. Stories: 003, 024, 056 (F-003-01/03, F-024-02/03, F-STORY-056-01).
10. **Sharing has no owner-side UI and recipient pages lack context.** No create, list or revoke in the console; Trash silently kills live links; expired/revoked cards show no file name, sender or date. Stories: 042, 044, 046 (F-STORY-046-01/02, F-STORY-044-01/02/03, F-STORY-042-01/02).
11. **Usage and billing do not answer "am I near my limit?"** No allowance, no bars; Usage and Billing disagree on units and names. Stories: 072, 073.

## Flow Friction

Only stories whose walk report recorded a step count are listed. Others: not recorded.

| Story         | Goal                               | Ideal steps | Actual                                   | Notes                                      |
| ------------- | ---------------------------------- | ----------- | ---------------------------------------- | ------------------------------------------ |
| 001           | Reach sign-up from landing         | 2           | 3                                        | No sign-up control; hesitation at the hero |
| 003           | Create first drive                 | 3           | 4 clicks plus typing                     | Extra click is the acknowledgment          |
| 010           | Sign up and approve agent          | 3           | 5 if redirect_url is dropped (simulated) | Clerk not configured                       |
| 017           | Find a file by name                | 3           | 3                                        | Needed Load more                           |
| 024           | Empty console to connected agent   | 5           | about 12                                 | 7 screens or dialogs                       |
| 042           | Recipient downloads a shared file  | 2           | 2                                        |                                            |
| 049           | Restore file from Trash            | 2           | 2                                        |                                            |
| 057           | Approve an offered drive           | 3           | 3 plus 1 reload                          | Reload only if page was open early         |
| 065           | Replace a leaked key               | about 4     | about 10                                 | No Rotate action; wrong defaults           |
| 056           | Add agent to existing drive        | TBD         | 6 interactions plus 600px scroll         | Key re-entered by hand                     |
| 046           | Create a share link in the console | 3           | impossible                               | No UI                                      |
| 007           | Sign out                           | 2           | impossible in test mode                  | Clerk unset                                |
| 002, 006, 012 | Sign in / approve / delegate       | 2, 2, 3     | 2, 2, 3                                  | On target                                  |

## Top 10 Recommendations

Weighted toward the owner's goals: the dashboard should feel like a clear cloud drive, and sign-up and setup must work well.

1. **Add folder navigation to Files (breadcrumb plus folder rows).** Fixes the one high-severity gap that most separates this from Dropbox. Stories 017, 019, 022. (F-019-01)
2. **Add a Recent view and sortable columns (name, modified, size); make the filter search the server, not just loaded rows, and include author/date.** Stories 017, 019, 022, 049, 050. (F-022-01, F-017-02, F-019-02)
3. **Fix the backup-key banner end to end.** Clear it when the receipt file is saved, stop contradicting the checkbox, show healthy status in a neutral or green colour, show it once per drive, and give the human's own fix first. Stories 002, 003, 017, 024, 029, 046, 049. (F-024-01, F-003-02, F-029-01)
4. **Shorten setup: put "Connect an agent" (paste line plus pairing code entry) on the onboarding card, make steps 01/02/03 reflect state, and stop sending users to a disabled New API key.** Stories 003, 010, 024. (F-003-01, F-024-03, F-010-01)
5. **Fix mobile and sign-up discoverability: show a menu (or at least Sign in) in the header at 390px, add a visible "Sign up / Get started" on the landing page, and add onward links to the not-configured and pricing states.** Stories 001, 073. (F-001-02, F-001-01, F-STORY-073-03)
6. **Put drive and tab in the URL and remember the last drive.** Reload and deep links work; the restored file stays visible after restore. Stories 002, 018, 050. (F-018-02, F-002-01, F-050-01)
7. **Add a human share-link UI (create, list, revoke) and warn before Trash that live links will stop.** Also add file name and expiry context to recipient error cards. Stories 042, 044, 046. (F-STORY-046-01/02, F-STORY-044-01)
8. **Make /connect a clear approval screen.** Show permissions as a list with a highlighted change notice, mark the delegate option optional, fix spacing, make the Approved screen link to the console, and update live when an offer arrives. Stories 006, 009, 010, 012, 056, 057.
9. **Add a Rotate key action and make revoke legible.** Name the agent/key on each button, show the success notice where the user is looking (toast), disable Revoke at 0 keys, default the key dialog to the working agent and drive. Stories 056, 062, 065, 066. (F-STORY-065-01, F-STORY-062-01/02)
10. **Exclude the console's own reads from the audit log and usage counts, and make Usage show plan allowance with bars, using the same units and names as Billing.** Stories 007, 022, 046, 072. (F-STORY-072-03, F-STORY-072-01/02)

## Needs verification

- **F-STORY-057-01.** A `/connect` page opened before `agent-drive grant` ran kept showing the new-drive form. The finding says that approving the stale page "results in a brand-new drive, not the offered drive." The walker did not run that approval; the claim is unobserved. Reading `apps/web/src/api/device.ts` (about line 626), the approve path compares the page's `offerRevision` (0 when no offer was shown) with the stored offer revision and throws a `conflict` ("The request changed; reload the page.") on mismatch, so approval without the current revision should be rejected with 409. Next step: open `/connect` before `grant`, run `grant`, click Approve on the stale page, and confirm a 409 and no new drive. If it succeeds, that is a high-severity bug. Independent of the answer, the page should refresh itself when the offer arrives.
- Clerk sign-up and sign-in forms, Clerk's own sign-up link, and whether `redirect_url` survives sign-up (STORY-001, 007, 010). Re-walk with Clerk configured.
- Sign-out (STORY-007). The user menu could not render without Clerk.
- Items that came from a headless-only look: the unlabelled orange dot on the share card (F-STORY-042-03) and the black border stubs in the Usage table (F-STORY-072-04) should be confirmed visually in a real browser.
- Share expiry shortly before the limit (STORY-044): the CLI refuses expiry under 2 minutes, so that variation was not walked.
- Whether the collapsed "Connect an agent" card shows a chevron on a real browser (F-024-02).

## Still Failing

| Story     | Failure Point                         | Reason                                                                | Blocked By              |
| --------- | ------------------------------------- | --------------------------------------------------------------------- | ----------------------- |
| STORY-001 | Create account from landing           | No sign-up control; header nav missing at 390px                       | Not filed (report only) |
| STORY-007 | Sign out                              | No sign-out path (Clerk unset; settings/billing have no account menu) | Environment; not filed  |
| STORY-019 | Browse by folder                      | No folder navigation                                                  | Not filed               |
| STORY-022 | See recent files                      | No Recent view or sort                                                | Not filed               |
| STORY-046 | Create/revoke a share link as a human | No UI                                                                 | Not filed               |

## Story Results Detail

| Story     | Status | Findings | Notes                                                                                |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------ |
| STORY-001 | FAIL   | 4        | No sign-up control on landing; header nav vanishes at 390px                          |
| STORY-002 | PASS   | 3        | Clean apart from default-drive choice                                                |
| STORY-003 | PASS   | 5        | Onboarding works; backup banner contradicts the checkbox just ticked                 |
| STORY-006 | PASS   | 3        | Code survives sign-in redirect; Approved screen is a dead end                        |
| STORY-007 | FAIL   | 4        | No sign-out reachable (Clerk unset; billing/settings have no account menu)           |
| STORY-009 | PASS   | 3        | Agent bootstrap works; llms.txt says nothing for human to choose, page shows options |
| STORY-010 | PASS   | 2        | Clerk unset; dropped redirect_url simulated                                          |
| STORY-012 | PASS   | 3        | Delegate checkbox unmarked as optional; CLI error does not name the fix              |
| STORY-017 | PASS   | 4        | Filter finds file in 3 actions; filters loaded rows only                             |
| STORY-018 | PASS   | 3        | Switch works; selection not in URL                                                   |
| STORY-019 | FAIL   | 2        | No folder navigation exists                                                          |
| STORY-022 | FAIL   | 4        | No Recent view or sort                                                               |
| STORY-024 | PASS   | 7        | Goal reached in about 12 actions (ideal 5)                                           |
| STORY-026 | PASS   | 3        | Real files decrypted correctly; weak feedback                                        |
| STORY-029 | PASS   | 5        | Banner hides the human fix until key loaded                                          |
| STORY-049 | PASS   | 4        | Restore from Trash in 2 clicks; truncated columns                                    |
| STORY-050 | PASS   | 4        | Rollback works; lands on empty filter result                                         |
| STORY-042 | PASS   | 3        | Recipient download in 2 steps                                                        |
| STORY-044 | PASS   | 3        | Error cards lack context                                                             |
| STORY-046 | FAIL   | 5        | Humans cannot create, list or revoke share links                                     |
| STORY-056 | PASS   | 7        | Works; 6 interactions plus scroll, key re-entered by hand                            |
| STORY-057 | PASS   | 3        | Offer flow works; stale page not updated (see Needs verification)                    |
| STORY-062 | PASS   | 5        | Revoke works; notice off-screen, buttons unlabelled                                  |
| STORY-065 | PASS   | 5        | No Rotate action; dialog defaults wrong                                              |
| STORY-066 | PASS   | 4        | Per-key revoke works; agent-level button unclear                                     |
| STORY-072 | PASS   | 5        | Cannot answer "near my limit?"; Usage vs Billing disagree                            |
| STORY-073 | PASS   | 4        | Paid plans are dead-end buttons                                                      |

Fixed and Issues columns are 0 and none for every story (report only).

## Environment Notes

- The machine was under heavy load; the work ran as three lanes (A sign-up/setup, B drive/download/versions, C share/agents/keys/billing), one walker and one agent-browser session per lane.
- Clerk is not configured locally, so /sign-in and /sign-up show a "not configured" card. Sessions were created through `/api/test-session` (synthetic users such as e2e_uxreview, e2e_walkerb, e2e_walkera3). The real Clerk forms were not walked.
- The test-session cookie expires, so a few lanes had to sign in again mid-walk.
- Walkers created throwaway agents, drives and files with synthetic data. Several test agents were not revoked afterwards.
- Counts of agents, operations and usage in STORY-072 include the walkers' own activity.
- Source hash for this run: apps/web last changed at commit e3a8306 (repo HEAD 4dead32).

## Run History

| Run | Date       | Walked | Passed | Failed | Fixes | Issues |
| --- | ---------- | ------ | ------ | ------ | ----- | ------ |
| 1   | 2026-11-06 | 27     | 22     | 5      | 0     | 0      |

---

_Generated by `/ux-walker` Phase 4 - 2026-11-06_
