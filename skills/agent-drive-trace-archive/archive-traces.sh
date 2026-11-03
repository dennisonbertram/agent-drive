#!/usr/bin/env bash
# Archive old trace files to Agent Drive; delete a local file only after the
# remote copy has been downloaded, decrypted and hash-matched.
# Usage: archive-traces.sh --dir DIR --drive DRIVE_ID [--older-than-days N] [--week YYYY-Www] [--dry-run]
# Env: AGENT_DRIVE_API_URL, AGENT_DRIVE_API_KEY, AGENT_DRIVE_KEY_<DRIVE_ID>,
#      AGENT_DRIVE_BIN (single executable path, default: agent-drive).
set -euo pipefail

BIN=${AGENT_DRIVE_BIN:-agent-drive}
DIR= DRIVE= DAYS=7 WEEK=$(date +%G-W%V) DRY=0
die() { echo "error: $*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case $1 in
    --dir) DIR=${2:?}; shift 2 ;;
    --drive) DRIVE=${2:?}; shift 2 ;;
    --older-than-days) DAYS=${2:?}; shift 2 ;;
    --week) WEEK=${2:?}; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -d "$DIR" ] || die "--dir must be an existing directory"
[ -n "$DRIVE" ] || die "--drive is required"
case $DAYS in ''|*[!0-9]*) die "--older-than-days must be a number" ;; esac
case $WEEK in [0-9][0-9][0-9][0-9]-W[0-5][0-9]) ;; *) die "--week must look like 2026-W45" ;; esac
DIR=$(cd "$DIR" && pwd -P)

if command -v sha256sum >/dev/null 2>&1; then
  hash() { sha256sum < "$1" | cut -d' ' -f1; }
else
  hash() { shasum -a 256 < "$1" | cut -d' ' -f1; }
fi

# The drive key must come from the environment, never the command line.
KEYVAR=AGENT_DRIVE_KEY_$(printf %s "$DRIVE" | tr -c 'A-Za-z0-9' _ | tr a-z A-Z)
[ -n "${!KEYVAR:-}" ] || [ -n "${AGENT_DRIVE_KEY:-}" ] || die "set $KEYVAR in the environment"

TMPDIR_RUN=$(mktemp -d)
trap 'rm -rf "$TMPDIR_RUN"' EXIT
ERR=$TMPDIR_RUN/err OUT=$TMPDIR_RUN/out

uploaded=0 present=0 deleted=0 failed=0 skipped=0 held=0 candidates=0

if [ "$DRY" = 0 ]; then
  "$BIN" whoami >/dev/null 2>"$ERR" || { cat "$ERR" >&2; die "whoami failed; check API URL, API key and network"; }
fi

SECRET_RE='adk_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|[Bb]earer [A-Za-z0-9._~+/=-]{20,}'

total=$(find "$DIR" -type f | wc -l | tr -d ' ')

# Old enough and quiet for the last hour (a trace still being written stays local).
while IFS= read -r -d '' f; do
  candidates=$((candidates + 1))
  rel=${f#"$DIR"/}
  remote=/traces/$WEEK/$rel

  if grep -aqE "$SECRET_RE" "$f"; then
    echo "HELD (possible secret, left local): $rel" >&2
    held=$((held + 1)); continue
  fi
  if [ "$DRY" = 1 ]; then echo "would archive: $rel -> $remote"; continue; fi

  rm -f "$OUT" "$ERR"
  version=
  if "$BIN" put "$f" "$remote" --drive "$DRIVE" --tag trace --tag "$WEEK" \
       --description "weekly trace archive" >"$OUT" 2>"$ERR"; then
    uploaded=$((uploaded + 1))
    version=$(sed -n 's/^{"id":"\([^"]*\)".*/\1/p' "$OUT")
    state=uploaded
  elif grep -q 'The file already exists' "$ERR"; then
    present=$((present + 1)); state=present
  else
    echo "FAILED upload: $rel: $(head -c 300 "$ERR")" >&2
    failed=$((failed + 1)); continue
  fi

  tmp=$(mktemp "$TMPDIR_RUN/dl.XXXXXX")
  vflag=; [ -n "$version" ] && vflag="--version $version"
  # shellcheck disable=SC2086
  if ! "$BIN" get "$remote" --drive "$DRIVE" $vflag --output "$tmp" >/dev/null 2>"$ERR"; then
    echo "FAILED download: $rel: $(head -c 300 "$ERR")" >&2
    failed=$((failed + 1)); rm -f "$tmp"; continue
  fi
  # Hash the local file now, so a file that changed during upload is kept.
  local_hash=$(hash "$f" || true) remote_hash=$(hash "$tmp" || true)
  # A failed hash yields an empty string; never treat two empty hashes as a match.
  if [ "${#local_hash}" -eq 64 ] && [ "$local_hash" = "$remote_hash" ]; then
    rm -f -- "$f"; deleted=$((deleted + 1))
    echo "$state, verified, deleted: $rel"
  else
    echo "FAILED verify (remote differs from local, kept): $rel" >&2
    failed=$((failed + 1))
  fi
  rm -f "$tmp"
done < <(find "$DIR" -type f -mmin +$((DAYS * 1440)) -mmin +60 -print0)

skipped=$((total - candidates))
verified=$deleted

# Final audit: remote file count under the week must cover what was verified this run.
remote_count=n/a
if [ "$DRY" = 0 ]; then
  remote_count=0 cursor=
  while :; do
    if [ -n "$cursor" ]; then
      "$BIN" ls --drive "$DRIVE" --prefix "/traces/$WEEK/" --cursor "$cursor" >"$OUT" 2>"$ERR" || break
    else
      "$BIN" ls --drive "$DRIVE" --prefix "/traces/$WEEK/" >"$OUT" 2>"$ERR" || break
    fi
    remote_count=$((remote_count + $(grep -o '"path":"/traces/' "$OUT" | wc -l)))
    cursor=$(sed -n 's/.*"nextCursor":"\([^"]*\)".*/\1/p' "$OUT")
    [ -n "$cursor" ] || break
  done
  if [ "$remote_count" -lt "$verified" ]; then
    echo "FAILED audit: remote lists $remote_count files, expected at least $verified" >&2
    failed=$((failed + 1))
  fi
fi

echo "summary week=$WEEK uploaded=$uploaded already_present_verified=$((present)) deleted=$deleted failed=$failed skipped=$skipped held_back_secrets=$held remote_files_in_week=$remote_count dry_run=$DRY"
[ "$failed" -eq 0 ]
