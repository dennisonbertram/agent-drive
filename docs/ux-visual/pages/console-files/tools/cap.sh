#!/bin/bash
S=ux-visual-console-files
SP=/Users/dennison/develop/agent-drive-t1/docs/ux-visual/pages/console-files/audit-raw
D=/Users/dennison/develop/agent-drive-t1/docs/ux-visual/pages/console-files
W=${1%x*}; H=${1#*x}; ST=$2
agent-browser --session $S set viewport $W $H >/dev/null
agent-browser --session $S eval "document.querySelector('nextjs-portal')?.remove()" >/dev/null
sleep 0.8
agent-browser --session $S eval "document.querySelector('nextjs-portal')?.remove()" >/dev/null
agent-browser --session $S screenshot $D/shots/$1-$ST.png >/dev/null
agent-browser --session $S screenshot --full $D/shots/$1-$ST-full.png >/dev/null
agent-browser --session $S eval "$(cat /Users/dennison/.claude/skills/ux-visual/references/layout-audit.js)" > $SP/$1_$ST.layout.txt
agent-browser --session $S eval "$(cat /Users/dennison/.claude/skills/ux-walker/references/geometry-audit.js)" > $SP/$1_$ST.geom.txt
agent-browser --session $S eval "(()=>{const e=document.scrollingElement;return JSON.stringify({vw:innerWidth,vh:innerHeight,pageScrollH:e.scrollHeight,scrollW:e.scrollWidth})})()"
