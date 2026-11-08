#!/bin/bash
# usage: vp.sh W H NEWCODE RECODE   [skipentry]
W=$1; H=$2; NEWC=$3; RECC=$4
SC=<repo>/docs/ux-visual/pages/connect/tools
S=ux-visual-connect; V=${W}x${H}; U=http://localhost:3230
ab(){ agent-browser --session $S "$@" >/dev/null; }
clickbtn(){ agent-browser --session $S eval "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('$1')).click(); 1" >/dev/null; }
ab set viewport $W $H
ab open $U/connect; sleep 2.5
[ "$5" = skipentry ] || $SC/cap.sh $V entry
# bad format
ab fill "input" "ABC"; clickbtn Continue; sleep 1; $SC/cap.sh $V bad-format
# not found
ab fill "input" "BBBB-CCCC"; clickbtn Continue; sleep 2; $SC/cap.sh $V not-found
# new drive
ab open "$U/connect?code=$NEWC"; sleep 3; $SC/cap.sh $V waiting-new-drive
# lookup error: patch fetch for GET
agent-browser --session $S eval "const f=window.fetch;window.fetch=(u,o)=>String(u).includes('/device/')&&(!o||!o.method||o.method==='GET')?Promise.resolve(new Response(JSON.stringify({error:{message:'The request could not be loaded.'}}),{status:500})):f(u,o);1" >/dev/null
ab open "$U/connect"; sleep 2
# approve error: patched fetch on approve
ab open "$U/connect?code=$NEWC"; sleep 3
agent-browser --session $S eval "const f=window.fetch;window.fetch=(u,o)=>String(u).includes('/approve')?Promise.resolve(new Response(JSON.stringify({error:{message:'Approval failed. Try again, or run agent-drive login for a new code.'}}),{status:500})):f(u,o);1" >/dev/null
clickbtn "Approve agent"; sleep 1.5; $SC/cap.sh $V approve-error
# reconnect
ab open "$U/connect?code=$RECC"; sleep 3; $SC/cap.sh $V reconnect
# approved
C=$($SC/dev.sh claude-code laptop); ab open "$U/connect?code=$C"; sleep 3; clickbtn "Approve agent"; sleep 2; $SC/cap.sh $V approved
# denied
C=$($SC/dev.sh claude-code laptop); ab open "$U/connect?code=$C"; sleep 3; clickbtn "Deny"; sleep 2; $SC/cap.sh $V denied
