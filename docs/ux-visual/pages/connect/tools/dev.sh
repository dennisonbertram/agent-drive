#!/bin/bash
# usage: dev.sh name machine [driveid]
PK=$(node -e "console.log(Buffer.concat([Buffer.from([4]),Buffer.alloc(64,7)]).toString('base64url'))")
B="{\"client_name\":\"$1\",\"machine\":\"$2\",\"public_key\":\"$PK\""
[ -n "$3" ] && B="$B,\"known_drive_ids\":[\"$3\"]"
B="$B}"
curl -s -H "x-forwarded-for: 10.$((RANDOM%250)).$((RANDOM%250)).$((RANDOM%250))" ${4:+-H "Authorization: Bearer $4"} -X POST http://localhost:3230/api/oauth/device_authorization -H 'content-type: application/json' -d "$B" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.user_code||s)})"
