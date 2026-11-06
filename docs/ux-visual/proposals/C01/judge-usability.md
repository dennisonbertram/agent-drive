# C01 judge: usability lens

Weighted total = 3 x criteria + 2 x simplicity + 2 x consistency + 2 x usability + 2 x visual + 1 x effort/risk (max 60). Columns: criteria met / simplicity / consistency / usability / visual / effort-risk (5 = lowest risk).

| Option | Crit | Simp | Cons | Usab | Vis | Risk | Weighted |
| ------ | ---- | ---- | ---- | ---- | --- | ---- | -------- |
| A      | 5    | 5    | 4    | 4    | 4   | 5    | 54       |
| B      | 5    | 4    | 5    | 5    | 4   | 3    | 54       |
| C      | 4    | 3    | 4    | 4    | 4   | 3    | 45       |

**Pick: A, with grafts.** A and B tie on score. I break the tie on risk: B moves `/`, `/pricing`, `/sign-in`, `/sign-up` into a route group and touches every relative import (B, Risks), while A reaches the same first-time-user outcome (Sign up free visible at every width, one click from the first viewport) with a server component and no JavaScript.

- B is the better pure-usability design: Docs, Pricing and Sign in are all visible at 390 with no menu to discover. A's `<details>` Menu is acceptable because the one action that matters (Sign up free) stays outside it.
- C loses: a focus-trapping sheet is new JavaScript for three links, and it relies on Clerk's footer link, which is unverified (C, Risks).
- Graft from B: a secondary "Create a free account" next to the first Copy panel in the hero, not only the final CTA. A first-time visitor decides in the hero.
- Graft from B: put the "New here? Create a free account / Already have an account? Sign in" line in a shared auth footer so Clerk's card needs no change. Keep it even if Clerk renders its own link (A, Risks), and hide Clerk's.
- Note for implementers: A makes `/pricing` dynamic (loses static caching); acceptable.
