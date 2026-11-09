# Capture traces

This page shows how to save an agent's model traffic as encrypted traces, either by running the agent through `agent-drive capture` or by sending OpenRouter traces to a webhook, and how to archive old trace files from disk. Use it when you want a searchable, encrypted record of what an agent sent to and received from a model.

## What a trace is and where it is stored

A trace is a JSON file that records one model API exchange: the request and the response. It is stored in your drive like any other file, encrypted before upload.

- **CLI capture path:** `/traces/<agent>/<YYYY-MM-DD>/<HHMMSS.mmm>Z_<model>_<id>.json`. `<id>` is 6 random hex characters.
- **OpenRouter webhook path:** `/traces/openrouter/<YYYY-MM-DD>/<HHMMSS.mmm>Z_<model>_<hash>.json`, where `<hash>` is the first 32 hex characters of the SHA-256 of the request body. If the payload has no usable span start time, the date folder is `undated` and the file is `/traces/openrouter/undated/<model>_<hash>.json`.
- **Tags:** `trace`, `agent:<agent>` and `model:<model>`. The model name is changed so that it holds only letters, digits, `.`, `_` and `-`, and is cut to 50 characters. An unknown model is `unknown`.

The path and tags are plaintext metadata that the service can see. File contents are encrypted. See [Threat model](threat-model.md).

## Capture with the CLI

```sh
agent-drive capture [--drive ID] [--agent NAME] -- COMMAND [ARGS...]
```

For example:

```sh
agent-drive capture --drive <drive id> -- claude
agent-drive capture --drive <drive id> --agent my-agent -- codex
```

Everything after `--` belongs to COMMAND. Only the flags before `--` are read by `capture`.

What happens:

1. The CLI starts a proxy on `127.0.0.1` on a random port.
2. It starts COMMAND with `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/anthropic` and `OPENAI_BASE_URL=http://127.0.0.1:<port>/openai` in the environment of that child process only. Your shell, shell profile, Claude settings and `~/.codex/config.toml` are not changed.
3. The proxy forwards each request unchanged to `api.anthropic.com` or `api.openai.com` and streams the response back as it arrives.
4. For each exchange it builds a redacted copy, encrypts it with the drive key, and queues it for upload.
5. When COMMAND exits, the CLI exits with the same exit code.

`--drive` can be left out when there is only one drive key saved for the current API. `--agent` defaults to the command's base name, in lowercase. It must be 1 to 40 characters: lowercase letters, digits, `.`, `_` or `-`, starting with a letter or digit.

For a command named `codex`, the CLI adds these arguments before yours, because Codex needs a provider entry and not only an environment variable:

```text
-c model_providers.agent_drive_capture.name="Agent Drive capture"
-c model_providers.agent_drive_capture.base_url="http://127.0.0.1:<port>/openai/v1"
-c model_providers.agent_drive_capture.env_key="OPENAI_API_KEY"
-c model_providers.agent_drive_capture.wire_api="responses"
-c model_providers.agent_drive_capture.supports_websockets=false
-c model_provider="agent_drive_capture"
```

Each request is also logged to standard error:

```text
capture: <METHOD> <path> <status> <ms>ms <captured | not captured: reason>
```

## What is and is not captured

Captured: HTTP calls to the Anthropic and OpenAI APIs made by an agent that honors the base URL variables, such as `claude` and `codex` in API-key mode.

Each trace file holds:

- The method, the path and the status.
- An allowlist of headers. Request headers: `content-type`, `accept`, `anthropic-version`, `anthropic-beta`, `user-agent`, `x-stainless-lang`, `x-stainless-package-version`, `x-stainless-runtime`. Response headers: `content-type`, `request-id`, `x-request-id`, `x-should-retry`, `retry-after`, the Anthropic and OpenAI rate-limit headers, `openai-processing-ms` and `openai-version`. No `authorization`, `x-api-key`, cookie or other header is saved.
- The request body and the response body. A streaming response is saved as a list of server-sent events. A body that is not valid UTF-8 text is replaced by its length and SHA-256.

Limits and redaction:

- Each body is cut at 4 MiB, and the whole file is kept under 9 MiB. Cut parts are named in the `truncated` list in the file.
- In the saved path, the value of any query parameter whose name contains `key`, `token`, `secret`, `auth` or `signature` is replaced with `[redacted]`. Request URLs are never printed to the terminal with their query string.
- The proxy holds at most 64 MiB of in-flight copies in memory. A request that would exceed that is still forwarded, but it is not captured (`not captured: memory`).
- An upstream connection error returns 502 to the agent and is not captured.

**Prompts are stored.** Everything you send to the model, including any secret you paste into a prompt, is saved in the trace. It is encrypted with your drive key, but it is there. Never put secrets in paths or tags.

Not captured: the Claude desktop app and editor extensions, other traffic from the agent (updates, telemetry), Codex WebSocket transport, Codex ChatGPT-login mode, and agents already pointed at another gateway.

## When capture is disabled

The agent always runs. If capture cannot start, the CLI prints one line and runs COMMAND with its environment and arguments unchanged:

```text
capture disabled: <reason>; running <command> without capture
```

The reasons are:

- A provider is already set. For `claude`, `ANTHROPIC_BASE_URL` is set. For `codex`, `OPENAI_BASE_URL` is set, or the arguments include a `-c model_provider` or `-c model_providers.*` setting, `--config`, `--profile` or `-p`. For any other command, either variable is set. The message names the flag or variable, never its value.
- Capture could not start: there are no saved API credentials, there is no drive key for the drive, the drive ID is not valid, or the port or the spool directory is not available.

## Spool and upload

Encrypted traces are first written to a local spool at `<config path>.state/capture/<drive id>/`. For the default config path, that is `~/.config/agent-drive/config.json.state/capture/<drive id>/`. The directory has mode `0700` and the files have mode `0600`. A trace is stored as ciphertext plus a small JSON sidecar. Plaintext is never written to disk.

A background task uploads the spool with create-only writes. Behavior:

- **Offline, 5xx or 429:** the traces stay in the spool and are retried on a later run.
- **Stop conditions (401, 402, 403, 413 and other client errors, such as an invalid key, no permission or no quota):** uploads stop and the traces stay for the next run. The CLI prints `capture: uploads stopped (<cause>); traces stay in <spool dir> for the next run`.
- **Server rejects a trace as invalid (400 `validation_error`):** the trace moves to `invalid/` inside the spool directory.
- **Already uploaded (409 exists):** treated as done.
- **Spool full:** the spool holds at most about 512 MiB. The cap is approximate when several capture processes share a spool. Past it, new traces are not saved and are counted as `spool full`.

When COMMAND exits, the CLI waits up to 5 seconds for captures in progress and up to 10 seconds in total for uploads, then prints one summary line:

```text
capture: <uploaded> uploaded, <queued> queued (<MiB> MiB in <spool dir>), <dropped> not captured (<reasons>), <invalid> invalid
```

Traces still queued are uploaded the next time you run `capture` for that drive.

## OpenRouter webhook

OpenRouter can send each trace to your drive. The service receives it over TLS, encrypts it to the drive's trace inbox, and stores it. This works without the CLI. It is not the same as `capture`: the service sees the trace in plaintext for the length of one request.

### Set up in the console

1. Open the drive in the console and choose the traces action (the "Capture traces" dialog).
2. Under "OpenRouter webhook", choose "Add webhook". The console needs the drive key in the tab. If the drive has none loaded, it asks for the recovery file. It checks that the key belongs to this drive before it continues. For a drive with no files, a pasted key cannot be checked, so load the recovery file or a credentials bundle instead.
3. The console creates the drive's trace inbox if the drive has none. It makes the inbox key pair in the browser and stores the private key wrapped under your drive key.
4. The console creates a webhook token. It starts with `adw_` and is shown once. Copy the webhook URL and the headers JSON now:

   ```text
   Webhook URL: https://<origin>/api/webhooks/openrouter/<drive id>
   Headers: {"Authorization":"Bearer adw_<64 hex characters>"}
   ```

5. In OpenRouter, add a Webhook destination with that URL and header. Leave Privacy Mode off for this destination. With it on, traces contain no prompts or replies.

A drive has one active webhook token. "Replace" creates a new token and revokes the old one. "Revoke webhook" stops it. The service stores only the SHA-256 of the token, so a lost token cannot be shown again. Replace it.

### What the endpoint does

`POST /api/webhooks/openrouter/:driveId` with `Authorization: Bearer adw_...`. The body is OTLP JSON, at most 4 MiB. HTTPS is required in production. The token is checked first, before the body is read.

| Case                                         | Response                                             |
| -------------------------------------------- | ---------------------------------------------------- |
| Missing, wrong, revoked or other-drive token | 401                                                  |
| Not HTTPS in production                      | 403                                                  |
| Body over 4 MiB                              | 413 `validation_error`                               |
| `X-Test-Connection` header present           | 200 `{ "ok": true }`. Nothing is stored or charged.  |
| Body is not a JSON object, or has no spans   | 200 `{ "ok": true, "stored": 0 }`                    |
| Stored                                       | 201 `{ "ok": true, "stored": 1, "path": "..." }`     |
| Same body delivered again                    | 200 `{ "ok": true, "stored": 0, "duplicate": true }` |
| The drive has no trace inbox                 | 409 `conflict`                                       |
| Drive quota exceeded                         | 413 `quota_exceeded`                                 |
| Plan budget exceeded                         | 402                                                  |

The path depends only on the body: the earliest span start, the model (`gen_ai.request.model` of the first span) and a SHA-256 prefix. A retry of the same body maps to the same path, which is how duplicates are detected. The stored file is JSON with `v`, `agent` (`openrouter`), `provider`, `receivedAt` and the original `otlp` payload.

To check the connection from a terminal:

```sh
curl -sS -X POST "https://<origin>/api/webhooks/openrouter/<drive id>" \
  -H "Authorization: Bearer <your webhook token>" \
  -H "X-Test-Connection: 1" \
  -H "Content-Type: application/json" \
  -d '{}'
```

A working token returns `{"ok":true}`.

### Encryption of webhook traces

The service holds the OpenRouter payload in plaintext, in memory, for the length of the request. It seals the payload with a random file key and wraps that key to the drive's trace inbox public key. It does not hold the drive key, it logs nothing from the body or the token, and it cannot read the stored file afterwards. Formats: [Encryption format](crypto.md).

### Read webhook traces

You open them with the same drive key as any other file. The client fetches the drive's inbox record and unwraps the inbox private key locally.

```sh
agent-drive ls --drive <drive id> --prefix /traces/openrouter/
agent-drive get "/traces/openrouter/<date>/<file>.json" --drive <drive id> --output ./trace.json
```

Use `--output` for traces. Without it, `get` prints only small text files, and the limit is 1 MiB. In the MCP server, `get` returns at most 64 KiB inline, and traces are often larger, so use the `download` tool with `outputPath`. See [MCP server and tools](mcp-tools.md).

## Archive old trace files

The `agent-drive-trace-archive` skill moves an agent's old local trace and log files into the drive. It uploads each file, downloads it again, compares SHA-256 hashes, and deletes the local file only when the hashes match. It is meant to run weekly from a scheduler.

Use a dedicated drive and a key with only the `read` and `write` scopes. The script `archive-traces.sh` uploads files older than 7 days (change it with `--older-than-days`) to `/traces/<week>/<path relative to the trace directory>` with the tags `trace` and the week. It skips files modified in the last hour. Run it with `--dry-run` first. A rerun is safe. A failed verification keeps the local file and exits 1.

The skill's full procedure, options and exit codes are in [Agent skills](skills.md).
