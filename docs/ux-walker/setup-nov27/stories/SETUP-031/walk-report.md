# SETUP-031 Install the skill where no agent folder exists - walk report

Status: PASS with findings (CLI only; no browser screen; no screenshots apply). Home copied from the SETUP-026 agent into backup-first-file-031 (fresh, no ~/.claude or ~/.codex). Whether Cursor loads the skill: not-walkable (no Cursor here).

1. `agent-drive skill install` -> `No ~/.claude or ~/.codex directory found. The skill is at /Users/agent/develop/.../dist/SKILL.md; copy it to <skills dir>/agent-drive/SKILL.md, or use --target <dir>.` exit 0, nothing written. Clear on what to do next, but exit 0 hides the miss from scripts. llms.txt step 5 presents install as a required step and does not mention what happens when no folder exists.
2. Cursor: neither CLI output, llms.txt nor docs/skills.md names Cursor or any non-Claude/Codex agent folder. `--target ./.cursor/skills/agent-drive` -> `wrote .cursor/skills/agent-drive/SKILL.md` exit 0 (relative path printed). `--target ./.cursor/skills` (the natural guess) -> `wrote .cursor/skills/SKILL.md`, a layout agents will not find; `--target claude` appends `skills/agent-drive` but a DIR does not, and nothing in the help says so (docs/skills.md does: "`--target DIR` writes `DIR/SKILL.md`").
3. `--target claude` with no ~/.claude: created it, `wrote /Users/agent/uxw/backup-first-file-031/.claude/skills/agent-drive/SKILL.md`.
4. Second `skill install` with ~/.claude present: same `wrote ...` line; silently overwrites (no "updated"/"already installed" wording).
5. `--target nowhere/x` wrote `nowhere/x/SKILL.md` without warning that the folder was created; `skill --help` prints the full CLI help (no skill-specific usage).
   Docs compare: llms.txt step 5 puts the skill before `check` (step 6) as required; docs/quickstart.md section 7 calls it "Optional". docs/skills.md offers `npx skills add dennisonbertram/agent-drive` (both skills) vs the CLI route with no advice on which to pick.

## Flow Log

- Specified 3 steps; needed 2 CLI runs to place the file (retry with --target); a user who guesses `--target ./.cursor/skills` needs a third to fix the layout.
- Hesitations: where Cursor reads skills; DIR vs DIR/agent-drive.
- Duplicated info: skill folder wording differs across llms.txt (~/.claude/skills or ~/.codex/skills), quickstart and CLI help.
