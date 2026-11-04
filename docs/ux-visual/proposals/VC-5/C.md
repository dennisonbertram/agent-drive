# VC-5 / C Convention: recommended card, limit-behavior line, FAQ accordion

## Pattern

Vercel, Linear and Stripe pricing pages use three cards where the recommended plan has a text pill ("Most popular") and the only filled button, the others have outline buttons; prices are whole numbers; each card ends with one line about what happens at the limit; details live in a "Compare plans" table or FAQ accordion below, not in dense paragraphs. Pattern only, no brand assets.

## Change

- Card header: plan name, one audience line (e.g. "For one person and their agents", TBD copy), then the price (`$20 / month`).
- Developer card: pill "Most popular" (text, not color alone), tinted background, filled button. Free and Team: `.secondary`.
- Four numbered facts per card (drives, storage, downloads, operations); the shared "CLI, MCP, ..." bullet is moved to a line under the cards.
- Each card ends with a one-line limit behavior in `--muted` 12px: Free `At the limit, uploads and downloads pause.`; paid `Beyond the limit: extra storage, drives and operations are billed; downloads are not charged.` (TBD, confirm policy with product).
- Under the cards, "How usage works" becomes a `<details>` accordion list with three items: "What counts toward storage", "What happens at my limit", "How overages are billed" (default: first open). This removes the dense paragraph card, keeps the rates `dl` visible inside the third item.
- Plan CTA button labels unchanged (already fixed).

## Before / after

Before: a dense fine-print card below the fold; limits mixed into paragraphs. After: each card states its own limit; the details are three scannable questions.

## Wireframe

```
+---------+   +--------------------+   +---------+
| Free    |   | (Most popular)     |   | Team    |
| For ... |   | Developer          |   | For ... |
| $0      |   | $20 / month        |   | $200    |
| 4 facts |   | 4 facts            |   | 4 facts |
| limit.. |   | limit..            |   | limit.. |
| [Start] |   | [Choose] filled    |   | [Choose]|
+---------+   +--------------------+   +---------+
All plans include CLI, MCP, web console and encrypted sharing.
> What counts toward storage
> What happens at my limit
> How overages are billed
```

## Files / selectors touched

`pricing/page.tsx`; `pricing.css`: `.plan-pill`, `.plan-audience`, `.plan-limit`, `.pricing-faq details`, replace `.pricing-details`; `.billing-plan.recommended` as in A; `--accent-border` token.

## Effort

M (copy, accordion markup, tests; no client JS, `<details>` is native).

## Risks

- Several new copy lines are policy statements that need owner sign-off.
- Collapsed details hide limits from skim readers; the limit line in each card carries the key rule so nothing critical is hidden.
- "Most popular" is an unverifiable claim; use "Recommended" or an audience pill if there is no data.

## How it meets the criteria

1. One filled button on the flagged plan: count test, as in A.
2. Allowance described once: the "downloads" fact states the number; the limit line states what happens; the overage row is reworded to match ("Downloads beyond allowance: Not charged").
3. Repeated bullet removed: moved to one line.
4. Limits visible without scrolling past cards: each card's limit line plus the open first accordion item are visible; the 5 GiB upload cap goes into the first accordion item and the shared line.
5. No ".00": `money()` rule.
