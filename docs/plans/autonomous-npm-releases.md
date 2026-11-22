# Plan: autonomous npm releases of the CLI

Status: proposal, not yet approved (2026-11-22).

## Goal

Let agents publish `@dennisonbertram/agent-drive` to npm without asking each
time. They must not be able to publish a broken, oversized or wrong package,
or remove anything that is already published.

## What exists today

- Pushing a tag `cli-vX.Y.Z` runs `.github/workflows/release-cli.yml`. The
  workflow builds the package and runs its unit tests. It checks that the tag
  matches `packages/agent-drive/package.json`, then runs
  `npm publish --provenance` through npm trusted publishing (OIDC). No npm
  token is stored anywhere.
- The published version is 0.1.1 (2026-11-09).
- The only thing that stops an agent is policy. `~/.codex/AGENTS.md` lists
  "an npm publish" as something to ask about.
- The repo has no GitHub rulesets and no deployment environments.

## Proposed changes

### 1. Policy (in `~/.codex/AGENTS.md`)

- Pre-approve **patch and minor** releases of `@dennisonbertram/agent-drive`
  through the tag workflow, when the gates below pass.
- Agents still ask before a **major** release, before publishing a **new
  package name**, and before any `npm unpublish`, `npm deprecate` or dist-tag
  removal. Unpublishing counts as deletion.

### 2. Release steps an agent follows

1. Bump `packages/agent-drive/package.json` in the same PR as the change. Use
   patch for fixes and minor for new commands or flags. Add a short entry to
   `packages/agent-drive/CHANGELOG.md`.
2. Merge the PR once review and CI pass.
3. Run an adversarial subagent review. It reads the diff since the last
   `cli-v*` tag, the `npm pack --dry-run` file list and the version bump. It
   looks for secrets in the package, unexpected files, a breaking change
   shipped as a patch or minor, and a removed command or flag.
4. If the review finds nothing blocking, tag the merged `main` commit as
   `cli-vX.Y.Z` and push the tag.
5. Watch the workflow until it finishes. Then check
   `npm view @dennisonbertram/agent-drive version`, install the package
   globally and run `agent-drive --version`.
6. The site-served CLI (`/cli/agent-drive.tgz`) updates with the next
   production deploy, which is the daily release on the Mac Studio.

Steps 3–5 can become one script, `pnpm release:cli`. It refuses to run unless
`main` is clean and matches `origin/main`, the version is new on npm, and the
tag does not already exist.

### 3. Workflow gates (add to `release-cli.yml`)

- **Tag on `main`:** fail unless the tagged commit is an ancestor of
  `origin/main`.
- **Package contents:** `npm pack --dry-run --json` must list only `dist/`,
  `README.md`, `LICENSE` and `package.json`, and stay under a size limit.
  Start with 2 MB; the current value is TBD (measure it).
- **Smoke test:** install the packed `.tgz` into a temporary directory, then
  run `agent-drive --version` (it must print the tag's version) and
  `agent-drive --help`.
- **Environment:** run the publish job in a GitHub environment named
  `npm-release`. Allow deployments only from `cli-v*` tags, with no required
  reviewers so it stays autonomous. Then limit the npm trusted publisher to
  that environment.

### 4. Repository protection (GitHub settings)

- A tag ruleset on `cli-v*` that blocks deleting or moving a tag, so a
  published version always maps to one commit.
- The branch ruleset already planned for the Mac Studio: block force-push
  and deletion on `main` and `prod`, and require CI on `main`.

### 5. If a release is bad

Do not unpublish. Publish a fixed patch release right away. If a version is
dangerous, for example because it leaks data, ask the user to deprecate it
with `npm deprecate`.

## What the user must do once

1. Approve the `AGENTS.md` policy change in section 1.
2. On npmjs.com, open the package's settings:
   - confirm that the trusted publisher is `dennisonbertram/agent-drive`,
     workflow `release-cli.yml`;
   - restrict it to environment `npm-release` after that environment exists;
   - set publishing access to "Require two-factor authentication and
     disallow tokens", so trusted publishing is the only way to publish.

   Agents cannot see or change npm package settings.

3. Approve creating the `npm-release` environment and the rulesets. These
   change repository settings, so they need your approval once.

## Open questions (TBD)

- Has trusted publishing worked before? 0.1.1 was published on 2026-11-09,
  but it is not verified that it came through the workflow. The 0.2.0
  release will show it.
- Package size limit: measure the current `.tgz` size first.
