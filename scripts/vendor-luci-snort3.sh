#!/usr/bin/env bash
# luci-app-snort3 is a JS + rpcd rewrite. Do not copy upstream Lua CBI.
# ImmortalWrt 25.x has no luci.cbi — restoring luasrc crashes Services → Snort IDS/IPS.
set -euo pipefail
echo "Refusing to vendor dddavid51/luci-snort3-openwrt Lua CBI into luci-app-snort3." >&2
echo "This feed uses htdocs/ + root/usr/share/rpcd (see feeds/luci/luci-app-snort3/UPSTREAM.md)." >&2
exit 1
