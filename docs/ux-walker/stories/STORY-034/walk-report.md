# STORY-034 walk — Roll back to an earlier version after an agent overwrote a file

Lead walk in signed-in Chrome. Precondition created via CLI: `/tests/note.jsonl` overwritten (`--overwrite`) so it has 2 versions. Status: **pass with findings**.

1. Files → Versions on `/tests/note.jsonl` → dialog "Version history", two rows (8:28:05 PM and 8:16:37 PM), each "82 B · trace-bot" with "Restore this version" (`finding-1-version-history.jpg`). Nothing marks the current version. Finding F-034-001.
2. Restored the 8:16:37 PM version → banner "Restored as a new version…"; row author now shows `__console__` (`finding-2-console-author.jpg`). Finding F-034-002.
3. Verified via CLI: `get /tests/note.jsonl` returns the original `{"step":1,...}` content; `versions` lists 3.

## Flow Log

- 2 steps vs ideal 2. Hesitation: identical rows make it hard to pick the right version.
