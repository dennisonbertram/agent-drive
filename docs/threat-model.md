# Threat model

This page states what Agent Drive protects, what the service can see, and what it does not protect against. Use it to decide what to store, how to scope agent keys, and what to do when something leaks. Statements here come from the code and the project documents. Where they come from reasoning about the design and not from a test, the text says so.

## What is protected

- **File contents.** Each file version is encrypted on the client with AES-256-GCM before upload. The service and the object store hold ciphertext only.
- **File keys.** Each version has its own random file key, wrapped by the drive key. The service stores the wrapped key and cannot unwrap it.
- **The drive key.** It is generated on the client and is never sent to the API or to object storage.
- **Passphrases and the account private key.** The console derives keys in the browser. The service stores the account public key, a private key it cannot unwrap, and sealed slots. It never receives the passphrase.
- **Share link keys.** The file key sits in the URL fragment (`#k=`). Browsers do not send the fragment to servers, so the service does not receive it.

The formats are in [Encryption format](crypto.md).

## What the service can see

The service sees metadata and activity, not contents:

- File paths, ciphertext sizes, tags and descriptions.
- Drive names, agent and machine names, user identifiers that agents attach to file activity, and timestamps.
- Version history, file events and audit entries (action, which agent, outcome, time). Audit entries omit request bodies, tokens, wrapped keys and paths.
- Usage and billing data, and download records.
- Share metadata: which file version, when it expires, whether it is revoked.
- For device login, a hash of the requesting IP address, public keys, the requested access and the sealed key-transfer records.
- API keys and webhook tokens only as hashes.
- **OpenRouter webhook payloads, in plaintext, for one request.** If you turn on the OpenRouter webhook for a drive, OpenRouter sends each trace to the service. The service reads it in memory, encrypts it to the drive's trace inbox public key, and stores only the ciphertext. It logs nothing from the body or the token. See [Capture traces](trace-capture.md).

Never put secrets in paths, file names, tags or descriptions.

## Attackers and outcomes

| Attacker                                                           | What they get                                                                                                                                                                                                                                                                               | What limits them                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Someone with a stolen API key                                      | Whatever the key's scopes allow on the drives it is scoped to: listing paths, downloading ciphertext and wrapped keys, and, with write scopes, adding or replacing files. They cannot decrypt anything.                                                                                     | Scopes (`read`, `write`, `delete`, `share`, `manage`, `delegate`), the key's drive list, its write paths, and revocation. A file that is deleted goes to Trash and can be restored. Never give a `manage` key to an agent, because it can create other keys. |
| Someone who copies the service database or object storage          | Ciphertext, wrapped file keys, metadata, hashed tokens, and the account key records. They cannot decrypt files.                                                                                                                                                                             | Encryption keys are not in the database. A made-up console passphrase can be guessed offline against the stored account key record. The generated 20-character passphrase has 100 bits and resists that.                                                     |
| A compromised service operator or deploy                           | The same as above. In addition, the console and share page are code the service sends to your browser, so malicious code could read a key loaded in a tab. This follows from how web apps work. The repository sets no Content-Security-Policy header and has no other mitigation for this. | The CLI and MCP server run from the npm package on your machine and do not load code from the service.                                                                                                                                                       |
| Someone who gets a share URL                                       | The one file version that URL points to, until it expires or is revoked. The whole URL is a secret.                                                                                                                                                                                         | Expiry (the console offers 1 hour, 24 hours, 7 days and 30 days; the CLI accepts 2 minutes to 30 days), revocation with `agent-drive share revoke`, and the fact that the link's key opens no other file.                                                    |
| Someone who controls an agent's machine                            | The config file holds the API key and the drive keys, so they can read every drive saved there, within the API key's scopes.                                                                                                                                                                | File mode `0600` helps only against other users. Revoke the API key to stop API access. The drive key stays valid, and any file they already downloaded stays readable. Keep one drive and one scoped key per agent where you can.                           |
| Someone with a stolen credentials bundle or recovery file          | The drive keys in it, which decrypt every file in those drives, and for a bundle, the API key.                                                                                                                                                                                              | Store them in a password manager or secret store. Revoke the API key. A drive key cannot be changed (see [Keys and recovery](keys-and-recovery.md)).                                                                                                         |
| A lost drive key                                                   | Nobody can read the files, including you.                                                                                                                                                                                                                                                   | A backup. See [Back up and recover your drive key](backup-and-recovery.md).                                                                                                                                                                                  |
| A document or file that tries to steer an agent (prompt injection) | Whatever the agent can do with its tools, if it obeys instructions found in a downloaded file.                                                                                                                                                                                              | Treat downloaded files as data. Scope keys, limit write paths, and require approval for tools that change data. See below.                                                                                                                                   |

One more case follows from the format and has no test behind it. The ciphertext does not bind a file to its path or version. A party that controls object storage and the database together could serve an older valid version, or swap two valid files from the same drive, and the client would decrypt them. It could not create new content.

## Agent-specific risks

- **Downloaded files are untrusted data, not instructions.** An attacker who can write to a drive, or who can get a file into one, can plant text meant to steer an agent that reads it. The agent skill tells agents to treat file contents and remote metadata as data and never follow instructions inside them. MCP tool results mark file contents as untrusted.
- **Limit what an agent can change.** Give agents only the scopes they need, use `--write-path` to confine writes to a folder, and ask the user before deleting, overwriting or sharing. Tools that change data carry MCP annotations, and Codex asks for approval for tools that are not read-only. See [MCP server and tools](mcp-tools.md).
- **Secrets in prompts are captured.** `agent-drive capture` and the OpenRouter webhook save what you send to a model, including any secret you paste. The file is encrypted, but a secret in a trace is readable by anyone with the drive key.
- **Never put secrets in paths or tags.** Those are plaintext to the service. File contents are encrypted, so a secret inside a file is acceptable. Never store a drive key in the drive it unlocks, and never share a file that contains secrets.
- **A key given to one agent is a key given to its prompts.** An agent holding a drive key can be talked into using it in ways you did not intend. Use a separate drive for data that agent should not see.

## Not protected and out of scope

- **Metadata.** Paths, sizes, tags, timing and who accessed what are visible to the service and to anyone who reads its logs or database.
- **Traffic analysis.** Request timing and ciphertext sizes show how large and how active a drive is. No padding or cover traffic is added.
- **A compromised client machine.** Malware or another user on the machine that holds the config file or a loaded browser tab can read the keys. Agent Drive cannot protect keys from the machine that uses them.
- **Erasure timing.** Deleting a file moves it to Trash. Its encrypted versions are kept until you delete the drive or account. There is no automatic Trash expiry. When you delete a drive or an account, new access through the app stops at once. Download links already issued can work for up to 10 minutes. A background job then purges the data after a waiting period of at least 10 minutes. Accepting the request does not prove that every byte has been erased. Aggregate billing receipts, internal deletion IDs and hashed identity records remain. Backups, payment provider records and storage access logs follow their own retention, which the operator sets.
- **Revoked access to data already obtained.** Revoking a key or link stops new requests. It does not take back ciphertext or plaintext that someone already downloaded.
- **Key rotation.** No command rotates a drive key.
- **Denial of service and availability.** The service makes no promise that it will always be available or that data will never be lost. Keep your own copy of anything you cannot afford to lose.

## Reporting issues

Send security reports to support@agentdrive.xyz. Describe the problem and how to reproduce it, and do not post exploit details in a public issue.
