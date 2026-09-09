#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DIR="$(cd "$(dirname "$0")" && pwd)"
FAIL=0

echo ">> node --check: luci-app-suricata JS"
if command -v node >/dev/null 2>&1; then
	node --check "$ROOT/htdocs/luci-static/resources/suricata-core.js" || FAIL=1
	node --check "$ROOT/htdocs/luci-static/resources/view/services/suricata.js" || FAIL=1
	node "$DIR/suricata-core.test.mjs" || FAIL=1
	sh "$DIR/test-config-apply.sh" || FAIL=1
else
	echo "SKIP: node not found"
	FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
	echo "luci-app-suricata js ok"
else
	echo "Some tests failed."
fi
exit "$FAIL"
