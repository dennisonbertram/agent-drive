# STORY-072: Check usage after a heavy week — walk report
Result: PASS with gaps (the user can find storage and operations, but the Usage tab does not answer "am I near the limit?" and its numbers disagree with the Billing page). Signed in as e2e_uxreview (Free plan, 2 drives, 15 agents including my throwaway ones, so counts include my walk).

## Steps
1. Console, Usage tab (step-1-usage.png): three stat cards. ENCRYPTED STORAGE 9.7 KB ("All committed versions, including trash"), API OPERATIONS 619 ("Successful operations this calendar month"), EGRESS & COST which holds a "Billing & limits" button and a line of help text but no figure. The third card therefore breaks the pattern of its siblings (big number + caption). Geometry audit: only intentional unevenness (tile strip, footer); no overflow.
2. Storage by drive (step-1-usage.png): rows "nightly-builds 268 B · account limits apply / 3 live files · 3 stored versions" and "research-bot 9.4 KB · account limits apply / 29 live files · 37 stored versions". There are no bars, and "account limits apply" does not tell her the limit (5 GiB, which only the Billing page states); the gap in the story is confirmed.
3. Usage by author (step-3-author.png): columns AGENT, STORAGE, VERSIONS, OPERATIONS for 15 rows sorted alphabetically with "Console" in the middle. Seven rows are all zeros. Console (the owner's own browser) accounts for 477 of 619 operations (77%), so the headline "API OPERATIONS" mostly counts the owner's own page loads. Visual defect: the first-column cells have a solid black 1px bottom border (rgb 17,17,17) while the other cells use a 9% grey border, which draws a dark stub under each agent name (computed styles confirm; visible in step-3-author.png).
4. Clicked "Billing & limits": /console/billing (step-4-billing.png) opens as a separate page (header "Settings", "Back to files", no sidebar). It shows NOVEMBER 2026 · ESTIMATE $0.00, RETAINED STORAGE 9.7 KiB, "5.0 GiB included · 2 drives", OBSERVED DOWNLOADS "Not connected" with "2.5 KiB authorized this month", then plan cards, spending controls and "Usage by agent". Geometry audit clean.
5. Mobile 390x844 (mobile-check.png): cards stack, no overflow; the table fits (356/356 wide).

## Cross-surface comparison
- Units: Usage tab "9.7 KB" and research-bot "8.9 KB"; Billing "9.7 KiB" and "8.8 KiB". The same data in two unit systems.
- Same table twice: "Usage by author" (STORAGE, VERSIONS, OPERATIONS) vs "Usage by agent" (RETAINED STORAGE, OBSERVED DOWNLOADS, OPERATIONS); Console count differs by 3 between loads (477 vs 480) because every page view adds operations.
- The Billing header link says "Settings" but the sidebar item is "Activity & deletion" (URL /console/settings).
- "Not connected" is shown as a large stat value for downloads, which reads as an error on a healthy Free plan.

## Flow log
- Ideal path 2; actual 2 for the numbers, +1 click (Billing) to learn the limit. Hesitation: what "account limits apply" means; why the EGRESS card has no number.
