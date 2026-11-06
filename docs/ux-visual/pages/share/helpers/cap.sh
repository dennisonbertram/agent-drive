#!/bin/zsh
# Share page capture. Keys come from the seed folder files at run time (not stored here).
cd /Users/dennison/develop/agent-drive-ux2/docs/ux-visual/pages/share
S=/private/tmp/claude-501/-Users-dennison-develop-agent-drive/72e5153f-f1c9-4e4b-819b-255bec507e75/scratchpad
ab() { agent-browser --session ux-visual-share "$@"; }
READY=$(cat $S/ux-seed/share-url.txt); RID=${${READY#*/s/}%%#*}; RKEY=${READY#*#k=}
REV=$(node -e "console.log('http://localhost:3500/s/zjMqPymz_D-UauiIoqOQ1A#k=HOXOCMke84aSSsSr72gMdGMF5o9Xv_5JYvSQdkZbTOc')")
WKEY=HOXOCMke84aSSsSr72gMdGMF5o9Xv_5JYvSQdkZbTOc
B=http://localhost:3500
LA=$(cat /Users/dennison/.claude/skills/ux-visual/references/layout-audit.js)
GA=$(cat /Users/dennison/.claude/skills/ux-walker/references/geometry-audit.js)
[ -f audit.json ] || echo '{}' > audit.json
shoot() {
  ab eval "document.querySelector('nextjs-portal')?.remove(); document.fonts.ready.then(()=>1)" >/dev/null
  sleep 0.5
  ab screenshot shots/$1-$2.png >/dev/null
  ab screenshot --full shots/$1-$2-full.png >/dev/null
  la=$(ab eval "$LA"); ga=$(ab eval "$GA")
  LL="$la" GG="$ga" node -e "const f=require('fs');const a=JSON.parse(f.readFileSync('audit.json'));const p=s=>{try{let v=JSON.parse(s);if(typeof v==='string')v=JSON.parse(v);return v}catch(e){return s}};a['$1/$2']={layout:p(process.env.LL),geometry:p(process.env.GG)};f.writeFileSync('audit.json',JSON.stringify(a,null,1))"
}
go() { ab open about:blank >/dev/null; ab open "$1" >/dev/null; ab wait 'main.share-shell' >/dev/null; sleep 1.5; }
for vp in "1440 900" "768 1024" "390 844"; do
  set -- ${=vp}; V=$1x$2
  ab set viewport $1 $2 >/dev/null
  go "$READY"; ab wait --text Download >/dev/null; shoot $V ready
  go "$B/s/$RID"; shoot $V missing-key
  go "$B/s/$RID#k=notakey"; shoot $V bad-key-format
  go "$B/s/$RID#k=$WKEY"; ab find role button click --name Download >/dev/null 2>&1; sleep 2; shoot $V wrong-key
  go "$REV"; shoot $V revoked
  go "$B/s/AAAAAAAAAAAAAAAAAAAAAA#k=$RKEY"; shoot $V not-found
  go "$B/s/$RID"
  ab eval "window.fetch=()=>new Promise(()=>{}); location.hash='k=$RKEY'; 1" >/dev/null; sleep 0.8; shoot $V loading
  go "$READY"; ab wait --text Download >/dev/null
  ab eval "const f=window.fetch; window.fetch=(u,...a)=>String(u).includes('/api/shares/')&&!String(u).includes('metadataOnly')?f(u,...a).then(r=>r.json()).then(j=>new Promise(()=>{})):f(u,...a); 1" >/dev/null
  ab find role button click --name Download >/dev/null 2>&1; sleep 0.8; shoot $V decrypting
done
echo done
