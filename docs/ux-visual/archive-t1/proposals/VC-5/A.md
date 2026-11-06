# VC-5 / A Minimal: move the filled button, add a label, say "cap" or "free" once

## Change

In `apps/web/app/(app)/pricing/page.tsx`:

1. Button emphasis: `className={`button ${name === 'developer' ? 'primary' : 'secondary'}`}` (today it is `name === 'free'`). Free stays a visible `.secondary` button.
2. Label: for the developer card render `<span className="plan-flag">Recommended</span>` above the `h2` (wording TBD with the owner; "Recommended" is a claim and should be confirmed).
3. Highlight class: stop reusing `.billing-plan.selected` on this page (it means "current plan" on Billing). Use a new `.billing-plan.recommended` with the same border and tint, defined in `pricing.css`.
4. Allowance wording (needs a product answer on whether downloads past the allowance are free on paid plans; the page currently implies both):
   - Free card bullet: `5 GiB downloads / month (hard limit)`.
   - Paid cards: `{n} GiB downloads / month, then not charged` when `egressNotMetered`, otherwise `{n} GiB downloads / month included`.
   - Overage row label: `Downloads beyond your allowance` with value `Not charged` (same word as the card).
5. Remove the repeated bullet `CLI, MCP, web console, and encrypted sharing` from the cards; add one line under the plan grid: `All plans include the CLI, MCP, web console, and encrypted sharing.`
6. `money()` for plan prices: whole dollars print without `.00` (`$20`), keeps `$0` for Free.
7. Under the grid, add one note line (12px `--muted`): `Versions and trash count toward storage. Each upload can be at most 5 GiB.`
   New token: `--accent-border: #c3e47a` (already used literally in `.primary`).

## Before / after

Before: lime button on Free, tinted Developer card without label, "included" vs "Not charged" contradiction. After: Developer carries the label, tint and the only filled button; one sentence defines downloads; limits note is visible with the cards.

## Wireframe

```
 Free            [Recommended]        Team
                 Developer
 $0 / month      $20 / month          $200 / month
 5 GiB dl (hard) 100 GiB dl, then     1024 GiB dl, then
 ...             not charged          not charged
 [ Start Free ]  [ Choose Developer ] [ Choose Team ]
                  (lime, filled)
 All plans include the CLI, MCP, web console and encrypted sharing.
 Versions and trash count toward storage. Max upload 5 GiB.
```

## Files / selectors touched

`pricing/page.tsx` (lines 62-85, rates table row), `pricing.css` (`.plan-flag`, `.billing-plan.recommended`), `console/billing/billing.css` (no change; `.selected` stays for Billing), optional `money()` helper.

## Effort

S (one page, one CSS file), plus a content decision.

## Risks

- A "Recommended" label is a claim; if Developer is not the intended default, pick another plan or use an audience label ("For one person with agents").
- Wording depends on the real overage policy; if wrong it is misleading on a billing page.
- Free sign-up becomes less prominent, which may change conversion; consider it a test.

## How it meets the criteria

1. One filled primary and it is on the labelled plan: step 1 and 2; test counts `.button.primary` inside `.billing-plans` = 1 and it is inside `.recommended`.
2. Allowance described once with consistent term: step 4.
3. Repeated bullet removed: step 5.
4. Storage limits visible at 1440x900 without scrolling past cards: step 7 puts them directly under the grid.
5. No ".00": step 6.
