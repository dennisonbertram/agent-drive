# The console

This page helps you use the console, the signed-in web app, to browse files, unlock a drive to open files, restore and share files, and manage agents, billing and your account. Sign in at [/sign-in](https://agentdrive.xyz/sign-in), then open `/console`.

## Sign in and drives

The side menu has these sections: Files, Agents, API keys, Usage, Trash, Billing & limits, and Activity & deletion.

Files lists the files in the selected drive. Use the drive menu at the top to switch drives or copy a drive ID. To create a drive in the browser, use New drive in that menu. The browser makes the drive key and offers a recovery file to download. Save it in a password manager, then click "I saved it". Nobody can recover the drive key for you. Tick "Agent-only" on New drive to keep the drive out of passphrase unlock entirely: its key is never sealed to your account, the console always asks for its recovery file, and the API refuses an account-key slot for it.

Files has three views: Browse (folders), Recent (newest first) and Shared (share links).

While the console is locked it shows only metadata: paths, sizes, tags, authors and timestamps. It cannot show file contents until you unlock the drive.

## Unlock

The key chip near the top of Files shows the state: Key needed, Key loaded, Locked or Unlocked. A "Not backed up" note appears until a backup of the drive key is recorded.

Load the key in one of these ways:

- **Passkey.** After setting up an account passphrase, add a passkey in the Files key menu. On a browser where the passkey is available, approve the device prompt to open an enrolled drive.
- Passphrase: set up passphrase unlock once, then a passphrase opens the drives in your account. A passphrase is at least 14 characters, or you can use one the browser generates. Agents that hold a drive key seal it to your account automatically, so agent-created drives open this way without a recovery file. "Forgot or exposed passphrase?" resets it. A reset removes every drive from your account key but does not delete files; you add each drive again with its recovery file.
- Recovery file: choose the recovery file for the drive. The file is named like `agent-drive-<id>.key.json`. The chooser also accepts an `adcred1.` credentials bundle saved as a file; it takes the key for this drive.
- Pasted key: open "Paste a key instead" and paste the drive key, or an `adcred1.` credentials bundle from `agent-drive credentials export`.

The passphrase prompt has a "Keep this browser unlocked" box, ticked by default. While it is ticked, the console keeps the account private key in this browser's IndexedDB as a non-extractable CryptoKey, so later visits open your drives with no prompt. "Lock this browser" in the key menu deletes it, and signing out clears it. Untick the box to be asked for the passphrase on every visit.

A drive key itself stays in memory in this browser tab. It is cleared when you reload the page or leave the Files page, or after 30 minutes without use, and is fetched again from its slot when needed. Agent-only drives have no slot by design: the console always asks for their recovery file.

If you have no recovery file, the simplest path pastes no secret at all:

1. Set up passphrase unlock once, if you have not: the banner on Files, or "Set up passphrase unlock" in the key menu.
2. Copy the drive ID from the drive menu and give the agent that holds the drive one command:

   ```sh
   agent-drive account seal --drive <drive id>
   ```

   It prints `<drive id>: sealed` or `already sealed`. `agent-only` means the drive is kept out of passphrase unlock by design; `no account key` means step 1 was skipped.

3. Open the drive’s key menu and choose **Download recovery file**. If prompted, use your enrolled passkey or your account passphrase. The downloaded file contains the existing drive key and opens existing file versions. Store it privately and confirm once it has saved.

You can also open any supported file directly in Files. On a new browser, sign in and choose your enrolled passkey when prompted. Your device may ask for a fingerprint, face scan or PIN. If the passkey is unavailable on that device, use your passphrase or recovery file.

If you skip the passphrase, the agent can instead write the bundle to a file on your machine (`agent-drive credentials export --to <path>`) and you choose that file. Do not let an agent paste the bundle or a key into a chat.

## Files

With the drive unlocked you can:

- Preview a file. Text and images show in a dialog, and MP4 and WebM videos play there with the browser's own controls (no autoplay). A video your browser cannot decode shows a message instead — use Download for it. Large files, binary files and unknown types show a message instead. Use Download for those.
- Download a file. It is decrypted in the browser.
- Open Versions from the row menu. Each version shows its time, size and author. "Restore this version" makes an older version the current one by creating a new version. Existing history stays.
- Trash a file from the row menu.

Downloads up to 32 MiB save with one click. Larger downloads use the browser file picker when available, or a temporary origin-private file before the browser starts the download. The temporary file contains plaintext and is removed after 15 minutes; the console also removes abandoned Agent Drive download files on a later visit. If the browser cannot stage a file to disk or storage is full, the console offers an explicit browser-memory download that may use memory equal to the file size.

Version and trash behavior:

- Overwriting a file or restoring an older version creates a new version.
- Restoring a file's current version from Trash only brings it back. It creates no new version.
- Trash does not free storage. All versions count toward storage, including files in Trash.

The Trash section lists deleted files with a Restore button.

## Shares

Choose Share from a file's row menu. Pick how long the link lasts (1 hour, 24 hours, 7 days or 30 days) and click Copy link. The link is a secret. It can be copied only when it is created, and anyone who has it can download that version of the file. Later changes are not included.

The dialog lists the links for the file with their state: Active, Expired, Revoked, or Unavailable (file in Trash). Use Revoke on an active link to stop it. The Shared view lists links for the whole drive. See [Share links](sharing.md).

## Traces

On Files, View traces opens the `/traces` folder in the Recent view. Set up trace capture opens the setup dialog:

- Local agents: shows the install command and the `agent-drive capture --drive <drive id> -- claude` command. See [Capture traces](trace-capture.md).
- OpenRouter webhook: Add webhook shows a webhook URL and a headers JSON once. Copy both into an OpenRouter Webhook destination, and leave Privacy Mode off for it, or traces will contain no prompts or replies. Replace makes a new token. Revoke webhook stops it.

Setting up the webhook needs the drive key loaded, so the console may ask you to unlock the drive first. Creating the inbox and issuing a token also require a fresh sign-in: you may be asked to confirm your identity before the console continues.

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
- Passphrase unlock status, with a link to manage it in Files. The status shows the account key's fingerprint — the same SHA-256 fingerprint the CLI pins the first time it seals a drive key. Comparing them is how you know an agent sealed to your real key.
- Delete your data: delete one drive (type its exact name) or delete your account (type `DELETE MY ACCOUNT`).
- Deletion requests: the status of each request.

Deletion cannot be undone. It removes retained versions, trash, share links and upload metadata. When a request is accepted, new access is disabled and a background purge is queued. The purge starts after the upload grace period (at least ten minutes). Storage or billing failures delay completion and are retried. Already-issued links may work until they expire. Accepting the request does not prove that every byte is erased yet; check Deletion requests for completion. Account deletion also closes billing and removes your sign-in identity.
