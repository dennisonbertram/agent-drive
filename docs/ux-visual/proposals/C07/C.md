# C07-C Convention: the OAuth consent pattern

Effort: M. Files: `connect.tsx`, `connect.css`.

## What others do

- GitHub device flow (`github.com/login/device`, then "Authorize <app>"): the app name is the heading, a bulleted permission list follows, then one green Authorize button and a Cancel; success page says "Congratulations, you're all set" with a link on.
- Google OAuth consent: "<app> wants to access your Google Account", the account chip on top, a checklist of scopes, Cancel and Allow at the bottom, details under "Learn more".
- Vercel CLI login and Tailscale device approval: the code is shown as a verification line ("confirm the code in your terminal"), never as the title.
- Slack app install: permissions grouped under "This app will be able to", with "Choose a channel" as the one selector.

## Change

Adopt that layout without a new component:

```
 Personal workspace  (account chip, top)
 Connect vis-agent-a?                         28px
 vis-agent-a on vis-b wants access to:
   * research-bot (new drive, encrypted)
   * read and write files
   * write only under /outputs
 Confirm the code in your terminal: MJRQ-QBXZ
 [ Deny ]                      [ Approve ]
 Add to an existing drive  >          (secondary row button, 44 px)
 Advanced options  >                  (delegate, read-only)
```

- Account chip replaces the Account row; facts shrink to the sentence "on vis-b".
- Permissions are a bullet list (`ul.connect-grants`), phrased as capabilities, built from `offer` or defaults. This is the structured list required by criterion 5.
- Deny sits left of Approve (GitHub, Google); both are 48 px.
- Existing-drive branch is a row button below the actions that opens an inline step: select the drive, "Drive key" field with Choose file, Approve stays in the same place. Back arrow returns.
- Approved: GitHub-style. Heading "vis-agent-a is connected". List of granted items. Primary link "Open console". Text: "The console updates when the agent finishes setup." If an offer arrives from the agent later, a poll updates the list and shows "New offer from research-bot" with a link to review it (reload of the card).

## Acceptance

1. Approve at about y 430 and inside every viewport. Met. 2. Existing step is a separate sub-view with fewer fields shown at once; card about 700 px at 1440; at 390 within 250 px scroll. Met. 3. Heading largest; code is a small line. Met. 4. Advanced collapsed; branch is a 44 px button. Met. 5. Bullets. Met. 6. 20 px accent-color checkboxes inside 44 px rows; hint above Approve at 16 px. Met. 7. "Drive key". Met. 8. Inline error. Met. 9. Met. 10, 11 as in A.

## Risks

The code is a small line, not the title, so a user could skip checking it. Placing it directly above the buttons keeps it in the reading path. The bullets must be generated from scopes in one function to keep wording consistent with the console (C10).
