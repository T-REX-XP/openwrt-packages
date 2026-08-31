#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node --check "$ROOT/htdocs/luci-static/resources/view/services/threat-prevention.js"
echo "luci-app-threat-prevention js ok"
