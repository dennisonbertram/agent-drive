# Judge brief: C05 mobile section nav and drive strip clip

App: Agent Drive operator console (T1 "Rack" style: light grey chassis, dark drive bays, signal-orange LEDs, mono labels). Persona: a developer checking on an agent's drive from a phone at 375x812.

Problem: on phones the console header stacks brand bar, a horizontally scrolling section tab strip (nav scrollWidth 576 vs 343), breadcrumb, a horizontally scrolling drive strip (scrollWidth 662 vs 375) and page header, about 320px before content. "Billing & limits" clips to a bare "$", "Activity & deletion" is invisible, the selected drive is clipped to "R", no overflow cue.

Acceptance: all 7 sections reachable and labelled (Files, Agents, API keys, Usage, Trash, Billing & limits, Activity & deletion); selected drive fully visible on load; no clipped labels; content starts at or above y=260.

Proposals (screenshots attached in order A, B, C):

- A Minimal: keep both strips; edge fade mask, scroll-snap, scrollIntoView on active tab and selected drive; hide breadcrumb. Content at y=191. Effort small. Section nav still needs a swipe; "Activity" cut at rest.
- B Restructure: fixed bottom tab bar (Files, Agents, API keys, Usage, Trash, More; More sheet holds Billing & limits and Activity & deletion) and one full-width drive switcher replacing the strip. Content at y=134. Effort large; billing/settings pages need the shared bar; two items one tap deeper.
- C Convention (Vercel / GitHub mobile / Linear): top bar shows current section as a menu button listing all 7 sections vertically; drive strip stays with fade, snap and scrollIntoView. Content at y=159 closed. Effort medium; one tap to switch section.

Score each proposal 1-5 on: (1) meets every acceptance criterion measurably x3, (2) simplicity x2, (3) consistency with the design system x2, (4) usability x2, (5) visual quality x2, (6) effort and risk (5 = small and safe) x1. Return a winner, an optional graft, and a defense.
