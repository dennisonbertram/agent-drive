#!/bin/zsh
cd /Users/dennison/develop/agent-drive-t1/docs/ux-visual/pages/share
S=/private/tmp/claude-501/-Users-dennison-develop-agent-drive/72e5153f-f1c9-4e4b-819b-255bec507e75/scratchpad
ab() { agent-browser --session ux-visual-share "$@"; }
J=$S/shares.json
url() { node -e "const j=require('$J');console.log(j['$1'].url)"; }
id() { node -e "const j=require('$J');console.log(j['$1'].id)"; }
key() { url $1 | sed 's/.*#//'; }
B=http://localhost:3230
LA=$(cat /Users/dennison/.claude/skills/ux-visual/references/layout-audit.js)
GA=$(cat /Users/dennison/.claude/skills/ux-walker/references/geometry-audit.js)
echo '{}' > audit.json
shoot() {
  ab eval "document.querySelector('nextjs-portal')?.remove(); document.fonts.ready.then(()=>1)" >/dev/null
  sleep 0.5
  ab screenshot shots/$1-$2.png >/dev/null
  ab screenshot --full shots/$1-$2-full.png >/dev/null
  la=$(ab eval "$LA"); ga=$(ab eval "$GA")
  LL="$la" GG="$ga" node -e "const f=require('fs');const a=JSON.parse(f.readFileSync('audit.json'));const p=s=>{try{let v=JSON.parse(s);if(typeof v==='string')v=JSON.parse(v);return v}catch(e){return s}};a['$1/$2']={layout:p(process.env.LL),geometry:p(process.env.GG)};f.writeFileSync('audit.json',JSON.stringify(a,null,1))"
}
go() { ab open "$1" >/dev/null; ab wait 'main.share-shell' >/dev/null; sleep 1.2; }
for vp in "1440 900" "1920 1080" "768 1024" "375 812"; do
  set -- ${=vp}; V=$1x$2
  ab set viewport $1 $2 >/dev/null
  go "$(url ready)"; ab wait --text Download >/dev/null; shoot $V ready
  go "$(url long)"; ab wait --text Download >/dev/null; shoot $V ready-longname
  go "$B/s/$(id ready)"; shoot $V missing-key
  go "$B/s/$(id ready)#k=notakey"; shoot $V bad-key-format
  go "$B/s/AAAAAAAAAAAAAAAAAAAAAA#k=$(key ready)"; shoot $V not-found
  go "$(url expired)"; shoot $V expired
  go "$(url revoked)"; shoot $V revoked-onload
  go "$B/s/$(id wrong)#k=$(key ready)"; ab find role button click --name Download >/dev/null 2>&1; sleep 1.5; shoot $V wrong-key
  go "$B/s/$(id ready)"
  ab eval "window.fetch=()=>new Promise(()=>{}); location.hash='k=$(key ready)'; 1" >/dev/null; sleep 0.6; shoot $V loading
done
echo done
