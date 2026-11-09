# Share links

This page shows how to share one file from a drive with a link that expires, and how to list and revoke links. The recipient needs no account.

## What a share link is

A share link is a secret. Anyone who holds the full URL can read the file until the link expires or you revoke it.

The URL has this shape:

```text
https://agentdrive.xyz/s/<share id>#k=<file decryption key>
```

The part after `#` is the URL fragment. It carries the key that decrypts this one file. Browsers do not send the fragment to servers, so the service never receives the key and cannot read the file. If the fragment is lost, nobody can open the file from that link, including you.

Treat the whole URL as a password. Do not share a file that contains secrets.

## Create a link

CLI:

```sh
agent-drive share /outputs/report.pdf --expires-in 24h
```

- `PATH` is the file to share.
- `--expires-in` takes a number and a unit: `m`, `h` or `d`, for example `30m`, `24h` or `7d`. The CLI accepts 2 minutes to 30 days. If you leave it out, the service uses 7 days.
- `--version ID` shares a specific version instead of the current one. The link points to one version; later writes to the path do not change what it shows.

The command prints JSON with `id`, `path`, `versionId`, `expiresAt` and `url`. Send `url` to the recipient. Your API key needs the `share` scope on the drive.

MCP: call the `share` tool with `path`, and optionally `driveId`, `versionId` and `expiresAt` (an ISO 8601 timestamp). It returns the same fields. See [MCP server and tools](mcp-tools.md).

Console: open the file, choose Share, pick an expiry (1 hour, 24 hours, 7 days or 30 days; 7 days is the default) and copy the link. See [The console](console.md).

## List and revoke

```sh
agent-drive share list
agent-drive share revoke <share id>
```

`share list` shows each link's `id`, `path`, `versionId`, `expiresAt`, `revokedAt`, `createdAt` and `status`. The status is one of:

| Status        | Meaning                        |
| ------------- | ------------------------------ |
| `active`      | The link works.                |
| `expired`     | The expiry time has passed.    |
| `revoked`     | The owner turned the link off. |
| `unavailable` | The file is in the trash.      |

The list does not include the URL or key, so it cannot rebuild a lost link. Create a new link instead. Add `--limit N` and `--cursor C` to page through a long list. `share revoke` prints the share id and the revocation time.

## What the recipient sees

The recipient opens the URL in a browser. The page at `/s/<share id>`:

1. Reads the key from the URL fragment.
2. Asks the service for the file name, size and expiry. When the recipient downloads, the service returns a short-lived download URL for the encrypted file.
3. Downloads the encrypted bytes and decrypts them in the browser.
4. Saves the decrypted file under its original file name.

If something is wrong, the page says so. The cases are: a missing key, a link that was not found, a revoked link, an expired link, a file that is no longer available, and a key that does not match the file. A link with less than one second left cannot start a download.

## Limits and risks

- The service enforces expiry. After it, the page shows "Share link expired".
- Revoking a link stops new downloads. It cannot take back a copy someone already downloaded, or a key someone already saved.
- Anyone with the complete URL can open the file. The service does not ask who they are.
- Moving a file to the trash makes its links `unavailable`. Whether restoring the file makes the links work again is TBD.
- Whether downloads through a share link count toward your plan's operation or egress limits is TBD; see [Errors and limits](errors.md).
- The service sees the file name, the size and who created the link. It does not see the contents. See the [Threat model](threat-model.md) and [Encryption format](crypto.md).
