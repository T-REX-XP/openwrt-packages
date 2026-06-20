#!/usr/bin/env bash
# Refresh vendored luci-app-snort3 from dddavid51/luci-snort3-openwrt.
# Upstream install.sh is unreliable — review output and re-apply template fixes if needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/feeds/luci/luci-app-snort3"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "https://codeload.github.com/dddavid51/luci-snort3-openwrt/tar.gz/refs/heads/main" \
	| tar -xz -C "$TMP" --strip-components=1

install -d "$PKG/luasrc/controller" "$PKG/luasrc/model/cbi/snort" "$PKG/luasrc/view/snort" "$PKG/po/en" "$PKG/po/fr"

cp "$TMP/src/controller/snort.lua" "$PKG/luasrc/controller/snort.lua"
cp "$TMP/src/model/cbi/snort/config.lua" "$PKG/luasrc/model/cbi/snort/config.lua"
cp "$TMP/src/view/snort/"*.htm "$PKG/luasrc/view/snort/"
cp "$TMP/src/i18n/snort.en.po" "$PKG/po/en/snort.po"
cp "$TMP/src/i18n/snort.fr.po" "$PKG/po/fr/snort.po"

echo "Copied upstream into $PKG"
echo "WARNING: verify luasrc/view and config.lua — upstream may contain corrupted concatenated files."
echo "Compare with UPSTREAM.md and re-run feed build."
