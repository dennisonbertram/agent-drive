# Share page (/s/ynkBnllNu3sLpeEMjwDRgg, no key fragment) visual audit, production, 2026-11-03

Shots in `shots/`, measures in `audit.json`. Second opinions: muse-wonder and gemini-4-argon. Excluded as known: "ad" logo, message accuracy for revoked links.

## Verdicts

- **1440x900** (`1440x900-default-1.png`): clear, calm error card. Headline leaves "key" alone on line 2. Nothing in the card is actionable. Lower 45 percent of the screen is empty.
- **1920x1080** (`1920x1080-default-1.png`): same card, 35 percent dead area (audit), top-anchored.
- **768x1024** (`768x1024-default-1.png`): same, card at 632px; fine.
- **375x812** (`375x812-default-1.png`): card fits with no overflow; headline wraps to two balanced lines.
- Interaction (`1440x900-focus-tab3.png`): the only tab stop is the logo; it shows a visible ring and links to `/`.

## Findings

| id  | level     | element                | problem                                                                                                                                                                                                                                                                      | norm   | evidence                                           | sev | found by                 | verified |
| --- | --------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------- | --- | ------------------------ | -------- |
| S1  | page      | error card             | Dead end: no button, field or link besides the logo. No path to paste a full link or key, and no copy-able message for the sender. Muse and argon rated P0; I rate P1 because the true fix is the sender resending the link, but the page gives the recipient nothing to do. | I3     | `1440x900-default-1.png`; links: only the logo     | P1  | own, muse, argon         | yes      |
| S2  | component | h1                     | Single-word widow "key" on line 2 at 1440, 1920 and 768. Heading lacks `text-wrap: balance`.                                                                                                                                                                                 | H3     | `1440x900-default-1.png`, `768x1024-default-1.png` | P2  | own, muse, argon         | yes      |
| S3  | component | lock tile              | Padlock on soft-green tile reads as "secure/success", on an error page. Takes 56px plus 40px margin as decoration.                                                                                                                                                           | H4, C3 | `1440x900-default-1.png`                           | P2  | muse, argon, own         | yes      |
| S4  | component | body copy              | "Everything after the # symbol" and "decryption key" are jargon for a non-technical recipient; no example of a complete link.                                                                                                                                                | C1     | `375x812-default-1.png`                            | P2  | muse, argon, own         | yes      |
| S5  | component | eyebrow, body, caption | Contrast 4.29 (eyebrow), 4.46 (body), 4.18 (caption). All under 4.5:1.                                                                                                                                                                                                       | A1     | audit lowContrast                                  | P2  | own, muse                | yes      |
| S6  | component | footer caption         | "The key stays in your browser" on a page whose problem is a missing key reads as contradictory.                                                                                                                                                                             | C4     | `1440x900-default-1.png`                           | P3  | muse, argon              | yes      |
| S7  | layout    | composition            | Content is top-anchored; 1920x1080 has 35 percent dead area. Logo and card icon are left-aligned but the caption is centered, giving two alignment axes.                                                                                                                     | D2, H6 | audit deadSpace; `1920x1080-default-1.png`         | P3  | own, argon               | yes      |
| S8  | component | brand                  | The wordmark has no tagline or explanation for a first-time recipient. Muse said the logo is inert; that is wrong, it links to `/`.                                                                                                                                          | C1     | link inventory                                     | P3  | muse (partly wrong), own | partly   |

Counts: P0 0, P1 1, P2 4, P3 3.

## Excellent as is

- Title "Encrypted share · Agent Drive" and `noindex, nofollow` are right for a private link.
- Card, header logo and eyebrow share a left edge; card shadow and radius match the rest of the app.
- Plain headline names the exact problem; no overflow at 375; visible focus ring on the logo.
