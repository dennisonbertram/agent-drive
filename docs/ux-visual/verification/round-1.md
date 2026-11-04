# Round 1 verification (branch ux-visual/round-1)

Measured on a production build (`next start -p 3410`, `S3_EGRESS_METERING=none`), headless agent-browser, layout-audit.js. Raw output: `landing-*.json`, `pricing-*.json`; shots in `shots/round1-*.png`. Console pages need sign-in and were NOT measured; for them only CSS reasoning and the contrast table below apply.

| Criterion                            | Result                             | Measurement                                                                                                                                                            |
| ------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VC-1 landing/pricing lowContrast = 0 | PASS                               | 0 entries at 375 and 1440 on both pages                                                                                                                                |
| VC-1 console selectors >= 4.5:1      | PASS by computation (not rendered) | table below; every changed selector 4.79-9.25, focus ring 3.84 (UI 3:1)                                                                                                |
| VC-1 no hex text outside :root       | PARTIAL                            | grey/green muted hexes tokenised; coloured status text (error/success/warning/outcome, dark-sidebar text, button colours) still literal hex, each already passes 4.5:1 |
| VC-2 min rendered text 12px          | PASS (public pages)                | min 12px on landing and pricing; sizes on landing 12/13/15/20/58-96                                                                                                    |
| VC-2 all font-size from tokens       | PASS                               | only 4 clamp() declarations remain (display sizes)                                                                                                                     |
| VC-2 console <= 6 sizes, row height  | NOT MEASURED                       | needs signed-in session                                                                                                                                                |
| VC-3 audit inner scroll removed      | PASS by CSS (not rendered)         | `max-height`/`overflow` removed from `.settings-page .table-scroll`; sticky header removed                                                                             |
| VC-4 command visible at 375          | PASS                               | code scrollWidth 224 = clientWidth 224; page scrollWidth 375 = viewport 375                                                                                            |
| VC-4 Copy button                     | PASS (rendered, not clicked)       | visible in screenshot; `navigator.clipboard.writeText`, sr-only `role=status` announces "Copied"                                                                       |
| VC-5 no allowance with env set       | PASS                               | all three cards show "Downloads not charged" (screenshot); unset case covered by unit test `downloadsLabel`                                                            |

## Contrast table (computed, WCAG relative luminance)

| Selector                                                                                          | Colour  | Background | Ratio | AA 4.5        |
| ------------------------------------------------------------------------------------------------- | ------- | ---------- | ----- | ------------- |
| .eyebrow, p, .muted, .feature-number, footer, topbar, breadcrumb, th, cell-subtext, etc (--muted) | #5f695f | #f7f8f4    | 5.36  | pass          |
| --muted on white panel                                                                            | #5f695f | #ffffff    | 5.72  | pass          |
| --muted on #fafbf8 (.panel-footer)                                                                | #5f695f | #fafbf8    | 5.51  | pass          |
| --muted on #fcfdfb (th)                                                                           | #5f695f | #fcfdfb    | 5.60  | pass          |
| --muted on #f8faf5 (.file-icon)                                                                   | #5f695f | #f8faf5    | 5.44  | pass          |
| --muted on #f0f2ed                                                                                | #5f695f | #f0f2ed    | 5.07  | pass          |
| .badge --text-2                                                                                   | #4a5448 | #f0f2ed    | 7.02  | pass          |
| td, .info, .setup-steps strong, .billing-plan ul (--text-2)                                       | #4a5448 | #f7f8f4    | 7.42  | pass          |
| .info --text-2 on #f1f4eb                                                                         | #4a5448 | #f1f4eb    | 7.12  | pass          |
| .row-actions button --link                                                                        | #58703d | #f7f8f4    | 5.18  | pass          |
| .row-actions button --link on white                                                               | #58703d | #ffffff    | 5.53  | pass          |
| .badge.positive --positive on #ecf5df                                                             | #4d6634 | #ecf5df    | 5.72  | pass          |
| .entity-avatar --positive on #eef4e3                                                              | #4d6634 | #eef4e3    | 5.72  | pass          |
| focus ring --focus on page (UI >=3)                                                               | #5c8a2c | #f7f8f4    | 3.84  | pass (UI 3:1) |
| .error                                                                                            | #983e30 | #fff0ed    | 6.18  | pass          |
| .success                                                                                          | #47612d | #eef7e1    | 6.31  | pass          |
| .warning-copy                                                                                     | #6f5a2a | #fbf5e8    | 6.09  | pass          |
| .billing-tag                                                                                      | #42582d | #eaf2dd    | 6.84  | pass          |
| .billing-banner                                                                                   | #405234 | #edf4e4    | 7.54  | pass          |
| .billing-banner.error                                                                             | #8d432c | #fff3ef    | 6.50  | pass          |
| .settings-outcome.success                                                                         | #415d28 | #edf4df    | 6.60  | pass          |
| .settings-outcome.failure                                                                         | #9b392a | #fff0eb    | 6.28  | pass          |
| .settings-outcome.pending                                                                         | #715d24 | #fff6de    | 5.92  | pass          |
| .settings-notice                                                                                  | #324c25 | #eef5df    | 8.54  | pass          |
| .settings-job-error                                                                               | #9b392a | #f7f8f4    | 6.54  | pass          |
| dark: .terminal-label                                                                             | #acb4a8 | #202a23    | 6.95  | pass          |
| dark: .terminal-preview p                                                                         | #929e90 | #202a23    | 5.30  | pass          |
| dark: .workspace-label small                                                                      | #89977e | #202a23    | 4.79  | pass          |
| dark: .nav-label                                                                                  | #899580 | #202a23    | 4.71  | pass          |
| dark: .privacy-note p                                                                             | #919e87 | #202a23    | 5.25  | pass          |
| dark: .nav-item                                                                                   | #b9c4b2 | #202a23    | 8.19  | pass          |
| dark: .profile-row                                                                                | #bac5b3 | #202a23    | 8.28  | pass          |
| dark: pre                                                                                         | #c9d9b5 | #243023    | 9.25  | pass          |
