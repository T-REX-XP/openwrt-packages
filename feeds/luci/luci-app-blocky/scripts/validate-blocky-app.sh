#!/bin/sh
# Validate blocky package helpers and luci-app-blocky catalog/UI assets.

set -u

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
FEEDS_ROOT="$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)"
PKG_ROOT="$FEEDS_ROOT/packages/blocky"
ERR=0

fail() {
	echo "validate-blocky-app: $*" >&2
	ERR=1
}

check_sh() {
	sh -n "$1" 2>/dev/null || fail "shell syntax error: $1"
}

echo "Checking shell scripts..."
for script in \
	"$PKG_ROOT/files/usr/sbin/blocky-lists-sync" \
	"$PKG_ROOT/files/usr/sbin/blocky-boot" \
	"$PKG_ROOT/files/usr/sbin/blocky-config-apply" \
	"$PKG_ROOT/files/usr/sbin/blocky-dnsmasq-sync" \
	"$PKG_ROOT/files/blocky.init" \
	"$PKG_ROOT/files/blocky-lan.init"
do
	[ -f "$script" ] || fail "missing $script"
	check_sh "$script"
done

CATALOG="$ROOT/root/usr/share/luci-app-blocky/blocklist-catalog.json"
echo "Checking catalog JSON..."
if ! python3 - "$CATALOG" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding='utf-8') as fh:
    data = json.load(fh)
presets = {p['id']: p for p in data.get('presets', []) if p.get('id')}
for pid, preset in presets.items():
    for key in ('name', 'url'):
        if not preset.get(key):
            raise SystemExit(f"preset {pid} missing {key}")
for group in data.get('catalog', []):
    for item in group.get('items', []):
        if item not in presets:
            raise SystemExit(f"catalog references unknown preset: {item}")
print(f"catalog OK: {len(presets)} presets, {len(data.get('catalog', []))} groups")
PY
then
	fail "invalid $CATALOG"
fi

if command -v node >/dev/null 2>&1; then
	echo "Checking blocky-common.js syntax..."
	node --check "$ROOT/htdocs/luci-static/resources/blocky-common.js" \
		|| fail "blocky-common.js syntax error"
else
	echo "Skipping JS syntax check (node not installed)"
fi

if [ "$ERR" -ne 0 ]; then
	exit 1
fi

echo "validate-blocky-app: all checks passed"
