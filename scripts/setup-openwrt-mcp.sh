#!/bin/sh
# Clone and build https://github.com/T-REX-XP/openwrt-mcp-server (host-side MCP for Cursor/Claude).
# Run from openwrt-packages repo root.

set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
REPO_DIR="${ROOT}/tools/openwrt-mcp-server"
PKG_DIR="${REPO_DIR}/packages/openwrt-mcp-server"
MCP_BIN="${PKG_DIR}/dist/bin/openwrt-mcp.js"
CURSOR_MCP="${ROOT}/.cursor/mcp.json"

OPENWRT_HOST="${OPENWRT_HOST:-192.168.8.1}"
OPENWRT_USER="${OPENWRT_USER:-root}"
OPENWRT_KEY_PATH="${OPENWRT_KEY_PATH:-${HOME}/.ssh/id_ed25519}"

if [ ! -d "${REPO_DIR}/.git" ]; then
	echo "Cloning openwrt-mcp-server into ${REPO_DIR} ..."
	git clone --depth 1 https://github.com/T-REX-XP/openwrt-mcp-server.git "${REPO_DIR}"
fi

echo "Building ${PKG_DIR} ..."
(
	cd "${PKG_DIR}"
	npm ci
	npm run build
)

if [ ! -f "${MCP_BIN}" ]; then
	echo "ERROR: build missing ${MCP_BIN}" >&2
	exit 1
fi

mkdir -p "${ROOT}/.cursor"
cat >"${CURSOR_MCP}" <<EOF
{
  "mcpServers": {
    "openwrt": {
      "command": "node",
      "args": ["${MCP_BIN}"],
      "env": {
        "OPENWRT_TRANSPORT": "ssh",
        "OPENWRT_HOST": "${OPENWRT_HOST}",
        "OPENWRT_USER": "${OPENWRT_USER}",
        "OPENWRT_KEY_PATH": "${OPENWRT_KEY_PATH}",
        "OPENWRT_TIMEOUT_MS": "15000"
      }
    }
  }
}
EOF

echo "OK: ${MCP_BIN}"
echo "Wrote ${CURSOR_MCP} (host=${OPENWRT_HOST}, user=${OPENWRT_USER})"
echo "Restart Cursor or reload MCP servers to pick up changes."
