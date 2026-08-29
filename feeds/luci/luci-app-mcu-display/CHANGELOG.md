# luci-app-mcu-display CHANGELOG

## 47

- **Host version from binary** — no more `/usr/share/mcud/version.json`; LuCI calls `mcudd -version-json`.
- **UCI-only settings** — removed optional `/etc/mcudd/config.json`.

## 46

- **Config parity with Go mcudd** — Configuration tab edits `/etc/config/mcud` (same UCI Go loads). Shows config path, effective `mcudd -dump-config`, and fills missing options from shared defaults on save.
- **Wire format** — MessagePack labeled as falling back to JSON until firmware support.

## 45

## 43 (2026-08-28)

### Changed

- Version lockstep with ESP32 firmware UI (dark theme, scoped refresh, stale metrics, `ROUTER_BTN_BOOT_GPIO`).

## 42 (2026-08-28)

### Added

- **Security scope** — firewall4 zone summary from UCI (`lan ok · wan Rj/drop`), Blocky 24h blocked via `/api/stats`, banIP `element_count` when installed, VPN tunnel count (`wg` / `awg` / tailscale Running).

## 41 (2026-08-28)

### Fixed

- **Active screen file** — `/tmp/mcud_active_screen` updates only on ESP32 `screen` evt ack (no optimistic write on TX).
- **Nav rate-limit** — drop FIFO `next`/`prev`/`screen`/`refresh` and host gesture echoes while a screen cmd is pending or within 450 ms of last TX (2.5 s ack timeout clears a stuck pending).

## 39 (2026-08-28)

### Added

- **Wi-Fi AP scope** — SSID + encryption from `/etc/config/wireless` (first `mode ap` iface; skips STA), AP `up` / `down` / `disabled` (UCI + `IFF_UP`, not carrier), WPA QR (`WIFI:T:WPA` / `nopass`) with JSON/QR escaping.

## 38 (2026-08-28)

### Added

- **Storage scope** — root `statvfs`, overlay/extroot from `/proc/mounts`, swap from `/proc/meminfo`.

## 37 (2026-08-28)

### Added

- **Network scope** — WAN RX/TX from `/proc/net/dev` deltas, background ping (gateway or 1.1.1.1), CM5 port badges (`eth0` WAN, `eth1`/`eth2` LAN) with carrier + speed.

## 36 (2026-08-28)

### Added

- **Real CPU %** from `/proc/stat` busy/idle deltas (load average stays in `load_short` only). First sample is 0% (no blocking sleep).
- **RK3588 temperature** — prefer `package-thermal`, then `soc-thermal`, then hwmon `tsadc`; `cpu_temp` is `--` when no sensor.
- Host tests: `tests/test_mcudd_metrics.c`.

## 12 (2026-07-06)

### Changed

- **CM5 debug UART default** — shipped UCI `path` is `/dev/ttyS2` (onboard 3-pin debug header, UART2 @ GPIO0_B5/B6) instead of FPC `/dev/ttyS4`; baud remains 115200.
- **uci-defaults** — CM5 first-boot and `99-mcud-cm5-uart-migrate` rewrite legacy USB/FPC paths to `/dev/ttyS2`; migration flag bumped to `cm5_uart_migrated=2`.
- **LuCI** — serial device help documents debug-header wiring and notes CM5 bootscript disables runtime serial console on ttyS2.

### Firmware (immortalwrt)

- Removed DTS patch **`9981-*-fpc-uart4`** (UART4 on J4 FPC no longer enabled).
- **CM5 bootscript** — drops `console=ttyS2,1500000` so mcudd can use the debug UART at 115200; `earlycon` retained for early boot only.

## 11 (2026-07-06)

### Changed

- **CM5 GPIO UART default** — shipped UCI `path` is `/dev/ttyS4` (UART4 mux m2 on J4 FPC pads 6/7) instead of `/dev/ttyUSB0`; baud remains 115200.
- **uci-defaults** — CM5 first-boot and `99-mcud-cm5-uart-migrate` rewrite legacy USB paths to `/dev/ttyS4` when `ttyS4` exists.
- **LuCI** — serial device help text documents J4 FPC wiring (TX/RX/GND, 3.3 V) and warns not to use `/dev/ttyS2`.

### Firmware (immortalwrt)

- DTS patch **`9981-*-fpc-uart4`** enables `uart4m2_xfer` on GPIO1_B2/B3 without conflicting with I2C7 or OLED RST.

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
