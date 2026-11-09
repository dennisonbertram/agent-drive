# The console

This page helps you use the console, the signed-in web app, to browse files, unlock a drive to open files, restore and share files, and manage agents, billing and your account. Sign in at [/sign-in](https://agentdrive.xyz/sign-in), then open `/console`.

## Sign in and drives

The side menu has these sections: Files, Agents, API keys, Usage, Trash, Billing & limits, and Activity & deletion.

Files lists the files in the selected drive. Use the drive menu at the top to switch drives or copy a drive ID. To create a drive in the browser, use New drive in that menu. The browser makes the drive key and offers a recovery file to download. Save it in a password manager, then click "I saved it". Nobody can recover the drive key for you.

Files has three views: Browse (folders), Recent (newest first) and Shared (share links).

While the console is locked it shows only metadata: paths, sizes, tags, authors and timestamps. It cannot show file contents until you unlock the drive.

## Unlock

The key chip near the top of Files shows the state: Key needed, Key loaded, Locked or Unlocked. A "Not backed up" note appears until a backup of the drive key is recorded.

Load the key in one of these ways:

- Recovery file: choose the recovery file for the drive. The file is named like `agent-drive-<id>.key.json`.
- Pasted key: open "Paste a key instead" and paste the drive key, or an `adcred1.` credentials bundle from `agent-drive credentials export`.
- Passphrase: set up passphrase unlock once, then a passphrase opens the drives you added to your account. A passphrase is at least 14 characters, or you can use one the browser generates. "Forgot or exposed passphrase?" resets it. A reset removes every drive from your account key but does not delete files; you add each drive again with its recovery file.

The key stays in memory in this browser tab. It is cleared when you reload the page or leave the Files page, or after 30 minutes without use. The key is not saved in browser storage.

If you have no recovery file, ask the agent that created the drive to run:

```sh
agent-drive credentials export
```

## Files

With the drive unlocked you can:

- Preview a file. Text and images show in a dialog. Large files, binary files and unknown types show a message instead. Use Download for those.
- Download a file. It is decrypted in the browser.
- Open Versions from the row menu. Each version shows its time, size and author. "Restore this version" makes an older version the current one by creating a new version. Existing history stays.
- Trash a file from the row menu.

Version and trash behavior:

- Overwriting a file or restoring an older version creates a new version.
- Restoring a file's current version from Trash only brings it back. It creates no new version.
- Trash does not free storage. All versions count toward storage, including files in Trash.

The Trash section lists deleted files with a Restore button.

## Shares

Choose Share from a file's row menu. Pick how long the link lasts (1 hour, 24 hours, 7 days or 30 days) and click Copy link. The link is a secret. It can be copied only when it is created, and anyone who has it can download that version of the file. Later changes are not included.

The dialog lists the links for the file with their state: Active, Expired, Revoked, or Unavailable (file in Trash). Use Revoke on an active link to stop it. The Shared view lists links for the whole drive. See [Share links](sharing.md).

## Traces

On Files, the Traces button opens the `/traces` folder in the Recent view. Capture… opens the setup dialog:

- Local agents: shows the install command and the `agent-drive capture --drive <drive id> -- claude` command. See [Capture traces](trace-capture.md).
- OpenRouter webhook: Add webhook shows a webhook URL and a headers JSON once. Copy both into an OpenRouter Webhook destination, and leave Privacy Mode off for it, or traces will contain no prompts or replies. Replace makes a new token. Revoke webhook stops it.

Setting up the webhook needs the drive key loaded, so the console may ask you to unlock the drive first.

## Agents and API keys

Agents lists the agents in your account. The Connect an agent panel shows the line to give an agent and MCP setup snippets. Create an agent makes an identity without a login. Revoke access on an agent revokes all of its API keys.

API keys lists keys with their state. Create API key asks for a label, an agent, the allowed drives and the permissions. Read and write are ticked by default. The secret is shown once; copy it and tick "I saved my API key securely". Revoke a key when you no longer need it. Revoked keys stop working at their next request. See [Connect an agent](connect-an-agent.md).

## Billing

[/console/billing](https://agentdrive.xyz/console/billing) (Billing & limits) shows:

- Plan allowances, retained storage and API operations for the current month.
- Spending controls: a monthly write cap in USD, an alert threshold and an alert email. A write cap stops new writes once estimated spend reaches it. It does not stop reads and is not a guaranteed invoice limit. A cap of zero blocks new writes immediately.
- Usage by agent, with a CSV download for a chosen month.
- Invoices & payment details, when your account has a billing customer.

For plans and prices see [/pricing](https://agentdrive.xyz/pricing). Paid checkout may be disabled on a deployment; the billing page shows what is available.

## Settings

[/console/settings](https://agentdrive.xyz/console/settings) (Activity & deletion) shows:

- Activity: the audit log for your account, most recent first. It holds metadata only, never file contents or credentials.
- Passphrase unlock status, with a link to manage it in Files.
- Delete your data: delete one drive (type its exact name) or delete your account (type `DELETE MY ACCOUNT`).
- Deletion requests: the status of each request.

Deletion cannot be undone. It removes retained versions, trash, share links and upload metadata. When a request is accepted, new access is disabled and a background purge is queued. The purge starts after the upload grace period (at least ten minutes). Storage or billing failures delay completion and are retried. Already-issued links may work until they expire. Accepting the request does not prove that every byte is erased yet; check Deletion requests for completion. Account deletion also closes billing and removes your sign-in identity.
