# luci-app-mcu-display CHANGELOG

## 1 (2026-07-06)

### Added

- **Phase 1 scaffold** — `mcudd` UART daemon, RDCP v1 + legacy JSON protocol, UCI-only configuration (no in-code defaults).
- **LuCI** — Services → MCU Display (`luci.mcu-display` rpcd, status/service/config view).
- **Shipped UCI** — `/etc/config/mcud`, `/etc/mcud/pages.json`.
- **Host tests** — `tests/run-tests.sh` (protocol, config parser, init syntax, JS check).
- **System design** — `docs/luci-app-mcu-display-system-design.md`.

### Notes

- `wire_format=msgpack` is validated in UCI but rejected at runtime until Phase 2.
- Network/WiFi/security scopes return `scope_unavailable` until ubus metrics are ported.
