# STORY-088 walk — Skim the audit log after an agent behaves oddly

Lead walk in signed-in Chrome, /console/settings. Status: **fail** (goal not achievable easily).

1. Audit log lists most-recent-first rows: WHEN / ACTION / ACTOR / RESULT. Agent rows show the agent and key label ("trace-bot / trace-bot weekly archive") — good.
2. The user's Trash action at 8:28:45 PM appears as `drive.delete`; opening the Trash tab appears as `drive.trash`; earlier rows showed `unknown`. Each console load adds 5-6 `*.list`/`usage.read` rows. No filter. Finding F-088-001.

## Flow Log

- Finding one agent's actions requires scanning every row and "Load older events"; ideal is a filter by actor.
