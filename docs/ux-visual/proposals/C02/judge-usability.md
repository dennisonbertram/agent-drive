# C02 judge: usability lens

Weighted total = 3 x criteria + 2 x simplicity + 2 x consistency + 2 x usability + 2 x visual + 1 x effort/risk (max 60). Columns: criteria met / simplicity / consistency / usability / visual / effort-risk (5 = lowest risk).

| Option | Crit | Simp | Cons | Usab | Vis | Risk | Weighted |
| ------ | ---- | ---- | ---- | ---- | --- | ---- | -------- |
| A      | 4    | 4    | 3    | 3    | 3   | 5    | 43       |
| B      | 5    | 3    | 5    | 5    | 4   | 3    | 52       |
| C      | 3    | 3    | 4    | 3    | 4   | 3    | 40       |

**Pick: B, with grafts.** One status value (`loading|slow|error|ready`) makes the false empty state impossible, and it covers all five tabs with the same wording and Retry, which is what a user learns once and trusts. A fixes only Files and Trash and leaves Agents, API keys and Usage with hand-rolled copy (A, Effort and risk).

- C removes the panel footer, which carries the encryption/visibility message (C, Risks) and needs product sign-off; its keep-stale-rows-dimmed error bar is clever but adds a state users must interpret. Fails the clean error contract more than B.
- Graft from A: only Files and Trash must ship in the first pass; the other three tabs can adopt `<ListState>` after C04 settles, to limit conflicts in `console.tsx`.
- Graft from C: the Dropbox-style "No files match 'x'" with Clear filter is common to all; keep Trash columns as Name, Deleted (full date, nowrap), Size.
- Coordination: land C02-B first (B, Risks); C04 reuses its skeleton/empty variants. Do not drop the footer privacy line.
