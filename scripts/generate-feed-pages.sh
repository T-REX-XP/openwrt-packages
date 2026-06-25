#!/usr/bin/env bash
# Assemble GitHub Pages feed tree: public-key.pem + browseable index.html pages.
# Called from .github/workflows/release.yml after the release tarball is extracted.
set -euo pipefail

FEED_DIR="${1:?feed directory (e.g. public/immortalwrt-25.12/aarch64_generic)}"
PUBLIC_ROOT="${2:?public site root (e.g. public)}"
FEED_CHANNEL="${3:?feed channel (e.g. immortalwrt-25.12)}"
PKG_ARCH="${4:?package arch (e.g. aarch64_generic)}"
PAGE_BASE_URL="${5:-https://t-rex-xp.github.io/openwrt-packages}"

human_size() {
	local bytes="$1"
	if command -v numfmt >/dev/null 2>&1; then
		numfmt --to=iec-i --suffix=B "$bytes"
	else
		awk -v b="$bytes" 'BEGIN {
			split("B KB MB GB", u, " ")
			i = 1
			while (b >= 1024 && i < 4) { b /= 1024; i++ }
			printf "%.1f %s", b, u[i]
		}'
	fi
}

install_public_key() {
	local dest="$PUBLIC_ROOT/public-key.pem"
	if [[ -n "${PUBLIC_KEY:-}" ]]; then
		printf '%s\n' "$PUBLIC_KEY" > "$dest"
		echo "public-key.pem: from PUBLIC_KEY secret"
		return 0
	fi
	if [[ -f "$FEED_DIR/public-key.pem" ]]; then
		cp "$FEED_DIR/public-key.pem" "$dest"
		echo "public-key.pem: from release tarball"
		return 0
	fi
	if [[ -n "${PRIVATE_KEY:-}" ]]; then
		local tmp
		tmp="$(mktemp)"
		trap 'rm -f "$tmp"' RETURN
		printf '%s\n' "$PRIVATE_KEY" | grep -v '^untrusted comment:' > "$tmp"
		{
			printf 'untrusted comment: openwrt-packages release key\n'
			openssl ec -in "$tmp" -pubout
		} > "$dest"
		echo "public-key.pem: derived from PRIVATE_KEY secret"
		return 0
	fi
	echo "::warning::No PUBLIC_KEY, tarball public-key.pem, or PRIVATE_KEY — public-key.pem will be missing on Pages" >&2
	return 1
}

feed_url="${PAGE_BASE_URL%/}/${FEED_CHANNEL}/${PKG_ARCH}/"
key_url="${PAGE_BASE_URL%/}/public-key.pem"

apk_rows=""
apk_count=0
while IFS= read -r -d '' apk; do
	name="$(basename "$apk")"
	size="$(stat -c%s "$apk" 2>/dev/null || stat -f%z "$apk")"
	hsize="$(human_size "$size")"
	apk_rows="${apk_rows}
    <tr>
      <td><a href=\"${name}\">${name}</a></td>
      <td class=\"size\">${hsize}</td>
    </tr>"
	apk_count=$((apk_count + 1))
done < <(find "$FEED_DIR" -maxdepth 1 -name '*.apk' -print0 | sort -z)

cat > "$FEED_DIR/index.html" <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>openwrt_packages — ${FEED_CHANNEL} / ${PKG_ARCH}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 52rem; padding: 0 1rem; line-height: 1.5; }
    h1 { font-size: 1.4rem; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #8884; padding: 0.4rem 0.6rem; text-align: left; }
    th { background: #8882; }
    td.size { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    code, pre { font-size: 0.9em; }
    pre { overflow-x: auto; padding: 0.75rem 1rem; background: #8881; border-radius: 4px; }
    a { color: inherit; }
  </style>
</head>
<body>
  <h1>openwrt_packages — ${PKG_ARCH}</h1>
  <p>ImmortalWrt <strong>${FEED_CHANNEL}</strong> feed for <strong>Orange Pi CM5 Base</strong>
    (<code>${PKG_ARCH}</code>). Machine index: <a href="packages.adb">packages.adb</a>,
    <a href="index.json">index.json</a>.</p>
  <p>Public signing key: <a href="${key_url}">public-key.pem</a></p>
  <h2>Packages (${apk_count})</h2>
  <table>
    <thead><tr><th>Package</th><th>Size</th></tr></thead>
    <tbody>${apk_rows}
    </tbody>
  </table>
  <h2>Install on router</h2>
  <pre># Trust the feed signing key (once)
wget -O /tmp/public-key.pem ${key_url}
# Install per your image apk docs, then:
echo "${feed_url}packages.adb" >> /etc/apk/repositories.d/openwrt_packages.list
apk update
apk add blocky luci-app-blocky</pre>
  <p><a href="${PAGE_BASE_URL%/}/">← Feed site root</a> ·
    <a href="https://github.com/T-REX-XP/openwrt-packages">Source repository</a></p>
</body>
</html>
EOF

cat > "$PUBLIC_ROOT/index.html" <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>openwrt_packages — Orange Pi CM5</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 42rem; padding: 0 1rem; line-height: 1.5; }
    code { font-size: 0.95em; }
  </style>
</head>
<body>
  <h1>openwrt_packages</h1>
  <p>ImmortalWrt feed for <strong>Orange Pi CM5 Base</strong> (RK3588 / <code>aarch64_generic</code>),
    built from
    <a href="https://github.com/T-REX-XP/openwrt-packages">T-REX-XP/openwrt-packages</a>.</p>
  <ul>
    <li><strong>${apk_count} packages</strong> —
      <a href="${FEED_CHANNEL}/${PKG_ARCH}/">${FEED_CHANNEL}/${PKG_ARCH}/</a>
      (browseable index + <code>packages.adb</code>)</li>
    <li>Signing key: <a href="public-key.pem">public-key.pem</a></li>
    <li><a href="https://github.com/T-REX-XP/openwrt-packages#option-d--install-from-published-feed">Install instructions</a></li>
    <li><a href="https://github.com/T-REX-XP/openwrt-packages/releases">GitHub Releases</a> (offline tarball)</li>
  </ul>
</body>
</html>
EOF

install_public_key || true

if [[ ! -f "$FEED_DIR/packages.adb" ]]; then
	echo "::error::packages.adb missing in $FEED_DIR" >&2
	exit 1
fi

if [[ "$apk_count" -eq 0 ]]; then
	echo "::error::No .apk files in $FEED_DIR — tarball may be incomplete" >&2
	exit 1
fi

echo "Generated index.html (${apk_count} packages) at $FEED_DIR and $PUBLIC_ROOT"
