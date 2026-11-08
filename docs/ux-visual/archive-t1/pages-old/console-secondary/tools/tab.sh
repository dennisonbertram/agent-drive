#!/bin/bash
S=ux-visual-console-secondary
agent-browser --session $S set viewport 1440 900 >/dev/null
agent-browser --session $S find role button click --name "$1" >/dev/null; sleep 1
"$AGENT_DRIVE_REPO"/docs/ux-visual/pages/console-secondary/tools/cap.sh $2
