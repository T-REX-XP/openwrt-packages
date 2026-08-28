# mcudd-old

Archived **C** implementation of the MCU display daemon (RDCP v1). Moved from `luci-app-mcu-display/src` during the Go rewrite.

| Item | Path |
|------|------|
| Sources | `src/mcudd/*.c` |
| Host tests | `tests/run-tests.sh` |
| OpenWrt package | installs `/usr/sbin/mcudd-old` (reference only) |

Production routers use **`feeds/packages/mcudd`** (Go) via `luci-app-mcu-display` → `+mcudd`.

Version manifest stays in `feeds/luci/luci-app-mcu-display/mcud-version.json`.
