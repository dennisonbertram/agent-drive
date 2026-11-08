#!/bin/bash
# usage: rv.sh W H N  -- fresh account e2e_connect_N: reconnect, approved, denied captures
W=$1; H=$2; N=$3; T=$(cd "$(dirname "$0")" && pwd); V=${W}x${H}; S=ux-visual-connect; U=http://localhost:3230
SECRET=$(cat "$UX_SCRATCH")
ab(){ agent-browser --session $S "$@" >/dev/null; }
clickbtn(){ agent-browser --session $S eval "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('$1')).click(); 1" >/dev/null; }
ab set viewport $W $H; ab open $U/; sleep 2
ab eval "fetch('/api/test-session',{method:'POST',headers:{'Authorization':'Bearer $SECRET','content-type':'application/json'},body:JSON.stringify({userId:'e2e_connect_$N'})}).then(r=>r.status)"
R=$(agent-browser --session $S eval "(async()=>{const j=async(p,b)=>(await fetch('/api/console/'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)})).json();const d=await j('drives',{name:'reconnect-drive'});const a=await j('agents',{name:'claude-code'});const k=await j('keys',{label:'k',agentId:a.id,driveIds:[d.id],scopes:['read','write']});return d.id+' '+k.token})()" | tr -d '"')
set -- $R
RC=$($T/dev.sh claude-code laptop $1 $2)
ab open "$U/connect?code=$RC"; sleep 3; $T/cap.sh $V reconnect
C=$($T/dev.sh claude-code laptop); ab open "$U/connect?code=$C"; sleep 3; clickbtn "Approve agent"; sleep 2; $T/cap.sh $V approved
C=$($T/dev.sh claude-code laptop); ab open "$U/connect?code=$C"; sleep 3; clickbtn "Deny"; sleep 2; $T/cap.sh $V denied
