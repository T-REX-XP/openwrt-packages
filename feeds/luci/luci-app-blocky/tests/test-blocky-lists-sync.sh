#!/bin/sh
# Host tests for blocky-lists-sync: empty enabled UCI must not restore package defaults.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
SYNC="$DIR/../../../packages/blocky/files/usr/sbin/blocky-lists-sync"
FAKE="$DIR/fixtures/fake-functions.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ ! -f "$SYNC" ]; then
	echo "SKIP: blocky-lists-sync not found at $SYNC"
	exit 0
fi

# Resurrection of package defaults must be gone from the writer.
if grep -q 'hagezi_light' "$SYNC"; then
	echo "blocky-lists-sync must not mention hagezi_light (no default resurrection)"
	exit 1
fi
grep -q 'denylists: {}' "$SYNC" || {
	echo "blocky-lists-sync missing empty denylists: {} branch"
	exit 1
}

export BLOCKY_FUNCTIONS="$FAKE"
export BLOCKY_LISTS_SYNC_SOURCED=1
# shellcheck disable=SC1090
. "$SYNC"

# All lists disabled → empty denylist, no package-default resurrection.
cat > "$TMP/uci-disabled" <<'EOF'
example_list|Example|https://example.com/list.txt|0
urlhaus|URLhaus|https://urlhaus.abuse.ch/downloads/hostfile/|0
EOF

BLOCKY_UCI_LISTS="$TMP/uci-disabled"
out="$(write_blocking_section)"
grep -q 'denylists: {}' "$out" || {
	echo "expected empty denylists, got:"
	cat "$out"
	exit 1
}
grep -q 'default: \[\]' "$out" || {
	echo "expected empty clientGroupsBlock.default, got:"
	cat "$out"
	exit 1
}
if grep -q 'example_list\|urlhaus' "$out"; then
	echo "empty UCI resurrected default lists:"
	cat "$out"
	exit 1
fi
rm -f "$out"

# One enabled list → that id only.
cat > "$TMP/uci-one" <<'EOF'
example_list|Example|https://example.com/list.txt|1
urlhaus|URLhaus|https://urlhaus.abuse.ch/downloads/hostfile/|0
EOF

BLOCKY_UCI_LISTS="$TMP/uci-one"
out="$(write_blocking_section)"
grep -q 'example_list:' "$out" || {
	echo "expected enabled example_list in denylist"
	cat "$out"
	exit 1
}
if grep -q 'urlhaus' "$out"; then
	echo "disabled urlhaus leaked into denylist:"
	cat "$out"
	exit 1
fi
grep -q 'denylists: {}' "$out" && {
	echo "enabled list produced empty denylists"
	cat "$out"
	exit 1
}
rm -f "$out"

echo "blocky-lists-sync empty denylist OK"
