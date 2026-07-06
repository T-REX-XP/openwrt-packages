# luci-app-mcu-display CHANGELOG

## 10 (2026-07-06)

### Fixed

- **LuCI Configuration tab** — `renderConfigForm` shadowed the `form` module with a local `var form`, causing `form.JSONMap` to throw at runtime. Use `m` for the map instance and wrap flat RPC config as `{ mcud: { main: … } }` for `JSONMap`.

## 4 (2026-07-06)

### Added

- **Syslog logging** — `mcudd` uses `LOG_DAEMON` ident `mcudd`; filter with `logread -e mcudd`.
- **UCI debug options** — `log_level` (`error` | `warn` | `info` | `debug`), `debug` (protocol frames), `debug_serial` (UART TX/RX trace).
- **LuCI Debug tab** — live log viewer via `getLogs` RPC; debug controls under Configuration.
- **uci-defaults** — migrate missing logging options on upgrade.

## 3 (2026-07-06)

### Added

- **Screen timeout** — UCI `screen_timeout` (seconds, 0=off) and `screen_timeout_mode` (`off` | `dim` | `blank`). `mcudd` pushes RDCP `push` / `op=config` on startup; LuCI form under Serial & protocol.
- **uci-defaults** — migrate missing `screen_timeout` / `screen_timeout_mode` on upgrade.

### ESP32 firmware (external)

Handle host line:

```json
{"v":1,"t":"push","op":"config","data":{"screen_timeout":60,"screen_timeout_mode":"off"}}
```

After `screen_timeout` seconds without touch, apply `off` (backlight off), `dim` (minimum brightness), or `blank` (clear LVGL). Wake on touch; reset idle timer on any input event.

## 2 (2026-07-06)

### Added

- **Full router metric scopes** — `clients`, `wifi` (SSID + WPA QR payload), `security` via UCI/sysfs.
- **UCI interface options** — `wan_if`, `lan_if`, `wifi_if` (required, no daemon defaults).
- **pages.json** — titles aligned with OLED page names.

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
