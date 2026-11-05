# Regressions and neighbouring-surface findings (2026-11-04)

Checked: landing, pricing, console tabs and dialogs, billing, settings, connect states, share states, sign-in/up at 1440x900, 1920x1080, 768x1024, 375x812. Shots in final/.

## Regressions / new defects
- R1 (new, minor-moderate): at 375x812 short console tabs leave a 95px band of the wrong background below the content. Trash tab: `.console-main` spans y 61-717 of 812, html/body are rgb(233,232,228) while main is rgb(251,250,248) (see final/375x812-tab-Trash.png). Agents/Usage are taller than the viewport so they do not show it; 768 and desktop fill the viewport (main bottom = innerHeight). Likely from the C04 shell height contract; the main column needs min-height 100dvh on phones.
- R2 (leftover): console onboarding still renders the old "a/" tile (`console.tsx:698`, class `onboarding-symbol`). final/1440x900-onboarding.png. Violates "no old a/ mark anywhere".
- R3 (leftover): onboarding shows two orange primary buttons ("+ New drive" and "Create your first drive").
- R4: Escape and the x button close dialogs but leave focus on BODY (C11).
- R5: Files table header "ENCRYPTED SIZE" is clipped behind "MODIFIED" at 768 and 900 (C01).
- R6: loading panel 416px vs loaded 595px at 1440 (C08), and the backup banner pops in after load.

## Pre-existing or deferred, seen again (not caused by these fixes)
- Landing at 768: the rack and its caption start at x=88 while all other content starts at x=20 (final/768x1024-landing-rack.png). Deferred C13.
- Page title is "Activity & deletion" while the header link on billing says "Settings" and the console nav says "Activity & deletion".
- Console page h1 "Drives & files" versus nav/breadcrumb "Files".
- API keys / Agents (1440): layout-audit reports a 21px-high link ("Read what your agent will see") and two adjacent copy buttons flagged as overlapping (Codex / Cursor snippets, 52x28), plus low-contrast flags on copy buttons and code (1.1-1.3:1, measured on the dark snippet panel, probably false positives like earlier audits).
- Usage tab: eyebrow/strong text flagged 2.5-2.8:1 contrast (muted text on tinted panel).

## Known-item checks
- Old "a/ agent drive" mark: gone from every header (all 26x26 new tile, text "Agent Drive"); remains only in R2.
- Lime/green: none. `.status-dot` rgb(255,90,31); grep finds no a2cb67 or greenish hex in apps/web/app.
- Double header rule: none; single rule on pricing, billing, settings.

## Environment notes (not app defects)
- During the run the Postgres and MinIO Docker containers (agent-drive-postgres-1, agent-drive-minio-1) stopped (exit 255) after the API had slowed to 2-4s per request; /api/console/billing returned 500 "The audit record could not be written." I restarted both with `docker start`; data was intact and billing worked again. All screenshots used for verdicts were re-checked after that, except those taken before the stop, which rendered normally.
- Local test login path: the CLI device login needs `--api http://localhost:3260/api`; the approve link it prints points at port 3100 and was rewritten to 3260.
