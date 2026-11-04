#!/usr/bin/env bash
# Self-contained tests for archive-traces.sh using a fake agent-drive backed by a temp dir.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(mktemp -d); trap 'rm -rf "$ROOT"' EXIT
export STORE=$ROOT/store
STUB=$ROOT/agent-drive
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
cmd=$1; shift
pos=() out= ver= prefix=
while [ $# -gt 0 ]; do
  case $1 in
    --output) out=$2; shift 2 ;;
    --version) ver=$2; shift 2 ;;
    --prefix) prefix=$2; shift 2 ;;
    --drive|--tag|--description|--cursor) shift 2 ;;
    *) pos+=("$1"); shift ;;
  esac
done
case $cmd in
  whoami) echo '{}' ;;
  put)
    dest=$STORE/files${pos[1]}
    if [ -e "$dest" ]; then echo 'The file already exists.' >&2; exit 1; fi
    mkdir -p "$(dirname "$dest")"; cp "${pos[0]}" "$dest"
    n=$(( $(cat "$STORE/n" 2>/dev/null || echo 0) + 1 )); echo $n > "$STORE/n"
    echo "{\"id\":\"$n\",\"path\":\"${pos[1]}\"}" ;;
  get)
    [ -z "${STUB_APPEND_ON_GET:-}" ] || echo more >> "$STUB_APPEND_ON_GET"
    if [ -n "${STUB_GET_CORRUPT:-}" ]; then echo corrupt > "$out"; else cp "$STORE/files${pos[0]}" "$out"; fi ;;
  ls)
    [ -z "${STUB_LS_FAIL:-}" ] || { echo "ls broke" >&2; exit 1; }
    items=
    if [ -d "$STORE/files" ]; then
      while IFS= read -r p; do items="$items{\"path\":\"${p#"$STORE/files"}\"},"; done \
        < <(find "$STORE/files" -type f | grep -F "$STORE/files$prefix" || true)
    fi
    echo "{\"items\":[${items%,}],\"nextCursor\":null}" ;;
  *) exit 9 ;;
esac
STUBEOF
chmod +x "$STUB"
export AGENT_DRIVE_BIN=$STUB AGENT_DRIVE_KEY_D1=x

pass=0 fail=0
check() { if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $1 (got '$2', want '$3')"; fi; }
setup() { rm -rf "$STORE" "$ROOT/t"; mkdir -p "$STORE" "$ROOT/t"; }
old() { printf '%s' "$2" > "$ROOT/t/$1"; touch -t 202001010000 "$ROOT/t/$1"; }
run() { OUTTXT=$("$HERE/archive-traces.sh" --dir "$ROOT/t" --drive d1 --week 2026-W45 "$@" 2>&1); RC=$?; }
has() { case $OUTTXT in *"$1"*) return 0 ;; *) return 1 ;; esac; }

setup; old a.jsonl hello; run
check happy-rc $RC 0; check happy-deleted "$([ -e "$ROOT/t/a.jsonl" ] && echo kept || echo gone)" gone
has "deleted=1 failed=0" || { fail=$((fail+1)); echo "FAIL: happy summary: $OUTTXT"; }
has "changed_during_run=0" || { fail=$((fail+1)); echo "FAIL: summary field"; }

setup; old a.jsonl hello; STUB_GET_CORRUPT=1 run
check mismatch-rc $RC 1; check mismatch-kept "$([ -e "$ROOT/t/a.jsonl" ] && echo kept || echo gone)" kept

setup; old a.jsonl 'key sk-abcdefghijklmnopqrstuvwxyz'; run
check held-empty-listing-rc $RC 3; has "held_back_secrets=1" || { fail=$((fail+1)); echo "FAIL: no summary on empty listing: $OUTTXT"; }

setup; old a.jsonl hello; STUB_LS_FAIL=1 run
check ls-fail-rc $RC 1; has "FAILED listing" || { fail=$((fail+1)); echo "FAIL: ls failure not reported"; }
has "failed=1" || { fail=$((fail+1)); echo "FAIL: ls failure not counted"; }

setup; printf 'x\xff y sk-abcdefghijklmnopqrstuvwxyz\n' > "$ROOT/t/bin.jsonl"; touch -t 202001010000 "$ROOT/t/bin.jsonl"
LC_ALL=en_US.UTF-8 run
check nonutf8-rc $RC 3; check nonutf8-kept "$([ -e "$ROOT/t/bin.jsonl" ] && echo kept || echo gone)" kept
check nonutf8-not-uploaded "$(find "$STORE/files" -type f 2>/dev/null | wc -l | tr -d ' ')" 0

setup; old a.jsonl hello; STUB_APPEND_ON_GET=$ROOT/t/a.jsonl run
check changed-rc $RC 0; check changed-kept "$([ -e "$ROOT/t/a.jsonl" ] && echo kept || echo gone)" kept
has "changed_during_run=1" || { fail=$((fail+1)); echo "FAIL: changed not reported: $OUTTXT"; }

setup; old 'with space.jsonl' one; old -dash.jsonl two; run
check names-rc $RC 0
check names-gone "$(ls "$ROOT/t" | wc -l | tr -d ' ')" 0

setup; old a.jsonl hello; run --dry-run
check dry-rc $RC 0; check dry-kept "$([ -e "$ROOT/t/a.jsonl" ] && echo kept || echo gone)" kept
check dry-nothing-uploaded "$(find "$STORE/files" -type f 2>/dev/null | wc -l | tr -d ' ')" 0

echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
