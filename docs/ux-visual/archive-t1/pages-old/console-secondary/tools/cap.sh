#!/bin/bash
S=ux-visual-console-secondary
D=/Users/dennison/develop/agent-drive-t1/docs/ux-visual/pages/console-secondary
T=/private/tmp/claude-501/uxcs
state="$1"; shift
if [ $# -eq 0 ]; then set -- 1440x900 1920x1080 768x1024 375x812; fi
for vp in "$@"; do
  w="${vp%x*}"; h="${vp#*x}"
  agent-browser --session $S set viewport "$w" "$h" >/dev/null
  sleep 0.8
  agent-browser --session $S eval "document.querySelector('nextjs-portal')?.remove()" >/dev/null
  agent-browser --session $S screenshot "$D/shots/$vp-$state.png" >/dev/null
  agent-browser --session $S screenshot --full "$D/shots/$vp-$state-full.png" >/dev/null
  agent-browser --session $S eval "$(cat /Users/dennison/.claude/skills/ux-visual/references/layout-audit.js)" > $T/l.txt 2>&1
  agent-browser --session $S eval "$(cat /Users/dennison/.claude/skills/ux-walker/references/geometry-audit.js)" > $T/g.txt 2>&1
  python3 - "$D/audit.json" "$vp/$state" $T <<'PY'
import sys,json,os
f,k,T=sys.argv[1:4]
def p(path):
    s=open(path).read().strip()
    try:
        v=json.loads(s)
        return json.loads(v) if isinstance(v,str) else v
    except Exception: return s
d=json.load(open(f)) if os.path.exists(f) else {}
d[k]={"layout":p(T+'/l.txt'),"geometry":p(T+'/g.txt')}
json.dump(d,open(f,'w'))
PY
done
echo done $state
