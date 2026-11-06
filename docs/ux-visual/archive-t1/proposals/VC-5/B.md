# VC-5 / B Restructure: one comparison table instead of three bulleted cards

## Change

Replace the three repeating bullet lists with a single table where plans are columns and limits are rows. Prices and the single filled button live in the column headers; shared features are stated once; limit rules go next to the numbers they qualify.

Rows: Drives, Stored ciphertext, Monthly downloads (with note), API operations / month, Max upload (5 GiB, all plans), Retained versions and trash (count toward storage, all plans).
Column header: plan name, price (`$0`, `$20`, `$200`), button. The Developer header has a text flag ("Recommended", TBD) and the filled button. A caption row under the table says: `All plans include the CLI, MCP, web console, and encrypted sharing.` The fine print card ("How usage works") is merged into the table as row notes and a short "Overages" definition list, so the allowance and the overage rate sit in the same row:
`Monthly downloads | 5 GiB (stops at limit) | 100 GiB, then not charged | 1024 GiB, then not charged`.
On phones (< 700px) the table switches to stacked plan sections with a sticky plan switcher (three buttons, 44px).

## Before / after

Before: cards plus a separate fine-print card, the same numbers in two places. After: one grid, one place per number, comparison without memory (fixes R11 too).

## Wireframe

```
                | Free      | Developer *       | Team
                |           | Recommended       |
                | $0        | $20               | $200
                | [Start]   | [Choose] (filled) | [Choose]
----------------+-----------+-------------------+----------
Drives          | 1         | 10                | 100
Stored          | 5 GiB     | 100 GiB           | 1 TiB
Downloads / mo  | 5 GiB (hard limit) | 100 GiB, then free | 1 TiB, then free
API ops / mo    | ...
Max upload      | 5 GiB on every plan
Versions, trash | count toward storage
All plans include CLI, MCP, web console, encrypted sharing.
```

(Numbers in the wireframe are illustrative of the layout only; real values come from `PLANS`.)

## Files / selectors touched

`pricing/page.tsx` (replace `section.billing-plans` and merge `section.pricing-details`), `pricing.css` (new `.plan-table`, `.plan-switcher`, remove `.pricing-details` rules), `globals.css` (`--table-header-bg` token if reused); `billing.css` `.billing-plans` stays for the Billing page.

## Effort

M-L (new table and mobile variant, tests at 3 widths).

## Risks

- Tables are weak on phones unless the switcher works; needs a 375 pass.
- Billing page keeps cards, so the two surfaces look different (VC-9 consistency).
- Loses the friendly card feel of the current design.

## How it meets the criteria

1. One filled button on the labelled plan: only the Developer header has `.primary`; count test.
2. Allowance described once: the Downloads row is the only place; overage table row removed.
3. Repeated bullet removed: stated once in the caption.
4. Limits visible without scrolling past cards: rows are part of the table; at 1440x900 the table (about 520px) fits above the fold.
5. No ".00": `money()` rule as in A.
