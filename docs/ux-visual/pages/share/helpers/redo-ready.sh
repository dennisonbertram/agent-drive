#!/bin/zsh
# recapture "ready" (previous run left window.fetch patched by the loading step; go through about:blank)
cd /Users/dennison/develop/agent-drive-t1/docs/ux-visual/pages/share
ab() { agent-browser --session ux-visual-share "$@"; }
J=/private/tmp/claude-501/-Users-dennison-develop-agent-drive/72e5153f-f1c9-4e4b-819b-255bec507e75/scratchpad/shares.json
U=$(node -e "console.log(require('$J').ready.url)")
LA=$(cat /Users/dennison/.claude/skills/ux-visual/references/layout-audit.js); GA=$(cat /Users/dennison/.claude/skills/ux-walker/references/geometry-audit.js)
for vp in "1440 900" "1920 1080" "768 1024" "375 812"; do
  set -- ${=vp}; V=$1x$2
  ab set viewport $1 $2 >/dev/null; ab open about:blank >/dev/null; ab open "$U" >/dev/null; ab wait --text Download >/dev/null; sleep 1
  ab eval "document.querySelector('nextjs-portal')?.remove();1" >/dev/null
  ab screenshot shots/$V-ready.png >/dev/null; ab screenshot --full shots/$V-ready-full.png >/dev/null
  la=$(ab eval "$LA"); ga=$(ab eval "$GA")
  LL="$la" GG="$ga" node -e "const f=require('fs');const a=JSON.parse(f.readFileSync('audit.json'));const p=s=>{try{let v=JSON.parse(s);if(typeof v==='string')v=JSON.parse(v);return v}catch(e){return s}};a['$V/ready']={layout:p(process.env.LL),geometry:p(process.env.GG)};f.writeFileSync('audit.json',JSON.stringify(a,null,1))"
done
echo ok
