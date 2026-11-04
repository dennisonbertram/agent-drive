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

# inode, size, mtime of a file; GNU stat accepts -c, BSD/macOS stat uses -f.
if stat -c '%i' / >/dev/null 2>&1; then
  fstat() { stat -c '%i %s %Y' -- "$1"; }
else
  fstat() { stat -f '%i %z %m' -- "$1"; }
fi

# The drive key must come from the environment, never the command line.
KEYVAR=AGENT_DRIVE_KEY_$(printf %s "$DRIVE" | tr -c 'A-Za-z0-9' _ | tr a-z A-Z)
[ -n "${!KEYVAR:-}" ] || [ -n "${AGENT_DRIVE_KEY:-}" ] || die "set $KEYVAR in the environment"

TMPDIR_RUN=$(mktemp -d)
trap 'rm -rf "$TMPDIR_RUN"' EXIT
ERR=$TMPDIR_RUN/err OUT=$TMPDIR_RUN/out

uploaded=0 present=0 deleted=0 failed=0 skipped=0 held=0 changed=0 candidates=0

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

  # Work on a private snapshot: scan, upload and verify the same bytes.
  snap=$TMPDIR_RUN/snap
  rm -f "$snap"
  before=$(fstat "$f" 2>/dev/null) || before=
  if [ -z "$before" ] || ! cp -p -- "$f" "$snap" 2>"$ERR" || ! chmod 600 "$snap"; then
    echo "FAILED snapshot: $rel: $(head -c 300 "$ERR" 2>/dev/null)" >&2
    failed=$((failed + 1)); continue
  fi

  # LC_ALL=C: byte-wise matching, so invalid UTF-8 cannot hide a secret.
  rc=0; LC_ALL=C grep -aqE "$SECRET_RE" "$snap" 2>/dev/null || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "HELD (possible secret, left local): $rel" >&2
    held=$((held + 1)); continue
  elif [ "$rc" -ne 1 ]; then
    echo "HELD (scan failed, left local): $rel" >&2
    held=$((held + 1)); continue
  fi
  if [ "$DRY" = 1 ]; then echo "would archive: $rel -> $remote"; continue; fi

  snap_hash=$(hash "$snap" || true)
  if [ "${#snap_hash}" -ne 64 ]; then
    echo "FAILED hash of snapshot: $rel" >&2
    failed=$((failed + 1)); continue
  fi

  rm -f "$OUT" "$ERR"
  version=
  if "$BIN" put "$snap" "$remote" --drive "$DRIVE" --tag trace --tag "$WEEK" \
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
  remote_hash=$(hash "$tmp" || true)
  rm -f "$tmp"
  # A failed hash yields an empty string; the length check rejects it.
  if [ "${#remote_hash}" -ne 64 ] || [ "$remote_hash" != "$snap_hash" ]; then
    echo "FAILED verify (remote differs from snapshot, kept): $rel" >&2
    failed=$((failed + 1)); continue
  fi

  # Delete only if the original is still exactly what was archived.
  # ponytail: a write landing between this check and rm is not detectable in bash.
  after=$(fstat "$f" 2>/dev/null) || after=
  orig_hash=$(hash "$f" 2>/dev/null || true)
  if [ -n "$after" ] && [ "$after" = "$before" ] && [ "$orig_hash" = "$snap_hash" ]; then
    rm -f -- "$f"; deleted=$((deleted + 1))
    echo "$state, verified, deleted: $rel"
  else
    echo "CHANGED during run (kept): $rel" >&2
    changed=$((changed + 1))
  fi
done < <(find "$DIR" -type f -mmin +$((DAYS * 1440)) -mmin +60 -print0)

skipped=$((total - candidates))
verified=$deleted

# Final audit: remote file count under the week must cover what was verified this run.
remote_count=n/a
if [ "$DRY" = 0 ]; then
  remote_count=0 cursor= ls_ok=1
  while :; do
    lsargs=(ls --drive "$DRIVE" --prefix "/traces/$WEEK/")
    [ -z "$cursor" ] || lsargs+=(--cursor "$cursor")
    if ! "$BIN" "${lsargs[@]}" >"$OUT" 2>"$ERR"; then
      echo "FAILED listing: $(head -c 300 "$ERR")" >&2
      failed=$((failed + 1)); ls_ok=0; remote_count=unknown; break
    fi
    remote_count=$((remote_count + $({ grep -o '"path":"/traces/' "$OUT" || true; } | wc -l)))
    cursor=$(sed -n 's/.*"nextCursor":"\([^"]*\)".*/\1/p' "$OUT")
    [ -n "$cursor" ] || break
  done
  if [ "$ls_ok" = 1 ] && [ "$remote_count" -lt "$verified" ]; then
    echo "FAILED audit: remote lists $remote_count files, expected at least $verified" >&2
    failed=$((failed + 1))
  fi
fi

echo "summary week=$WEEK uploaded=$uploaded already_present_verified=$((present)) deleted=$deleted failed=$failed skipped=$skipped held_back_secrets=$held changed_during_run=$changed remote_files_in_week=$remote_count dry_run=$DRY"
[ "$failed" -eq 0 ] || exit 1
# Exit 3 so a scheduler can alert when files were kept local because they may hold secrets.
[ "$held" -eq 0 ] || exit 3
