#!/bin/sh
# Host test for tp-eve-ingest (python json fallback + sqlite3).

set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
INGEST="$ROOT/files/usr/sbin/tp-eve-ingest"
FIX="$ROOT/tests/fixtures/eve-alert.jsonl"
DB=$(mktemp)
trap 'rm -f "$DB"' EXIT

command -v sqlite3 >/dev/null || { echo "sqlite3 required"; exit 1; }
command -v python3 >/dev/null || { echo "python3 required"; exit 1; }

sh -n "$INGEST"
sh -n "$ROOT/files/usr/sbin/tp-eventd"

"$INGEST" "@$FIX" "$DB" 10

n=$(sqlite3 "$DB" 'SELECT COUNT(*) FROM events;')
[ "$n" = 2 ] || { echo "expected 2 alerts, got $n"; sqlite3 "$DB" 'SELECT * FROM events;'; exit 1; }

sid=$(sqlite3 "$DB" 'SELECT sid FROM events ORDER BY id LIMIT 1;')
[ "$sid" = 2100498 ] || { echo "sid $sid"; exit 1; }

cls=$(sqlite3 "$DB" 'SELECT classtype FROM events WHERE sid=2100498;')
[ "$cls" = trojan-activity ] || { echo "class $cls"; exit 1; }

# Ring cap
"$INGEST" "@$FIX" "$DB" 1
n=$(sqlite3 "$DB" 'SELECT COUNT(*) FROM events;')
[ "$n" = 1 ] || { echo "ring cap failed n=$n"; exit 1; }

echo "tp-eve-ingest tests ok"
