#!/bin/bash
# usage: cap.sh viewportName state  (page already in the state; viewport already set)
cd <repo>
S=ux-visual-connect; V=$1; ST=$2; O=docs/ux-visual/pages/connect
agent-browser --session $S eval "document.querySelector('nextjs-portal')?.remove(); 1" >/dev/null
agent-browser --session $S screenshot $O/shots/$V-$ST.png >/dev/null
agent-browser --session $S screenshot --full $O/shots/$V-$ST-full.png >/dev/null
L=$(agent-browser --session $S eval "$(cat $HOME/.claude/…)")
G=$(agent-browser --session $S eval "$(cat $HOME/.claude/…)")
LL="$L" GG="$G" node -e "
const fs=require('fs');const f='$O/audit.json';let a={};try{a=JSON.parse(fs.readFileSync(f))}catch{}
const p=s=>{try{let v=JSON.parse(s);if(typeof v==='string')v=JSON.parse(v);return v}catch{return s}};
a['$V/$ST']={layout:p(process.env.LL),geometry:p(process.env.GG)};fs.writeFileSync(f,JSON.stringify(a,null,1))"
echo "captured $V/$ST"
