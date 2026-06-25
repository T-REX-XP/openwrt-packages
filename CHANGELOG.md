# Changelog

All notable changes to the **openwrt-packages** feed are documented here.

## [luci-app-oled r21] — 2026-06-25

### Fixed

- LuCI: add missing **Screen navigation button** and **Select / OK button** dropdowns (`menu_nav_button`, `menu_select_button`); UCI defaults in `/etc/config/oled`

## [luci-app-oled r20] — 2026-06-25

### Added

- UCI **`menu_nav_button`** (default `BTN_2` / MaskROM) and **`menu_select_button`** (default `wps` / USERKEY; `none` to disable)
- LuCI dropdowns **Screen navigation button** and **Select / OK button**
- FIFO event **`next`** — advances screens (System→Ports→WiFi→System) or cycles menu items
- `oledd_config.c` reads `menu_nav_button` / `menu_select_button` for startup logging

### Changed

- **Default screen navigation** — MaskROM (`BTN_2`) sends `next` (was `down` in r19)
- Hotplug `99-oled` reads UCI at runtime instead of hardcoded button map
- `cm5-oled-debug.sh` — reports `menu_nav_button`, `menu_select_button`, last FIFO events
- `docs/oled-menu-implementation.md` — configurable nav button, default MaskROM

### CM5 default button mapping (r20)

| Button | Hotplug `BUTTON` | FIFO event | Action |
|--------|------------------|------------|-------------|
| MaskROM | `BTN_2` | `next` | Next menu item or next screen |
| USERKEY | `wps` | `ok` | Select / open detail |

## [luci-app-oled r19] — 2026-06-25

### Added

- **FIFO input** — `/var/run/oledd.fifo` (fallback `/tmp/oledd.fifo`) with typed events: `net`, `up`, `down`, `ok`, `back`, `refresh`; helper `/usr/lib/oled/oledd-event.sh`
- **`oledd_input.c`** — FIFO create/read, non-blocking poll in main loop; event log at `/tmp/oledd_events.log`
- **`oledd_menu.c`** — interactive menu state machine (list + detail views); auto-rotate preserved when `menu_interactive=0`
- **CM5 button hotplug** — `/etc/hotplug.d/button/99-oled` (appends alongside `cm5-button-scripts`; does not replace `/etc/rc.button/*`)
- LuCI toggle **Interactive menu (oledd)**; UCI `menu_interactive` (default `1`)

### Changed

- Net hotplug `99-oled` sends `oledd-event.sh net` instead of touching `/tmp/oled_net_changed`
- `cm5-oled-debug.sh` — reports FIFO path, `menu_interactive`, last events
- `docs/oled-menu-implementation.md` — Phase 3 marked done

### CM5 two-button mapping (r19)

| Button | Hotplug `BUTTON` | FIFO event | Menu action |
|--------|------------------|------------|-------------|
| USERKEY | `wps` | `ok` | Select / open detail |
| MaskROM | `BTN_2` | `down` | Next item (list); back (detail) |

HAT joystick UP/DOWN/BACK deferred to Phase 3+ GPIO.

### Not yet implemented (Phase 4)

- `ubus` object `oledd` (control API)
- Preinit splash polish, error overlays
- Screen dimming / idle timeout enforcement

## [luci-app-oled r18] — 2026-06-25

### Added

- **libubus client** in `oledd` — replaces `popen("ubus call …")` with `oledd_ubus.c` (system info, `network.device`, `network.interface`, WiFi)
- **`oledd_net.c`** — CM5 port list (`eth0`/`eth1`/`br-lan`), carrier/link via ubus, IPv4 from `wan`/`lan` interfaces, RX/TX Mbps bars from `/sys/class/net/*/statistics/*_bytes`
- **`oledd_config.c`** — reads UCI `menu_wifi` from `/etc/config/oled`
- **WiFi view** in rotation — `hostapd.wlan0` / `network.wireless` with "WiFi N/A" fallback; UCI `menu_wifi` (default `1`)
- LuCI toggle **WiFi view (oledd)**
- Boot **ready** hook — `99-oled` hotplug calls `oled-boot-state.sh ready` on `eth0` or `br-lan` ifup

### Changed

- `LUCI_DEPENDS` adds `+libubus +libubox +libblobmsg-json`; `oledd` links libubus (legacy `oled` unchanged, still libconfig)
- Rotating views: Boot → System → Ports → WiFi (when enabled)
- `docs/oled-menu-implementation.md` — Phase 2 marked done

### Not yet implemented (Phase 3+)

- Joystick / GPIO button navigation
- `ubus` object `oledd` (control API)
- Screen dimming / idle timeout enforcement
- Error overlays (WAN down, high load)

## [luci-app-oled r17] — 2026-06-25

### Added

- **`oledd`** menu daemon (`/usr/sbin/oledd`) — Phase 1 foundation:
  - Boot splash (`BOOTING...`) on start
  - Auto-rotating views: Boot (reads `/tmp/oled_state`), System (ubus `system info`), Ports (`eth0` / `eth1` / `br-lan` link via `/sys/class/net/*/operstate`)
  - UCI options `menu_mode` and `menu_timeout`
- **`/etc/init.d/oledd`** — procd service, `START=09`, respawn; runs when `menu_mode=1`
- **`/usr/lib/oled/oled-boot-state.sh`** — writes boot progress to `/tmp/oled_state`
- **`/lib/preinit/80-oled-preinit`** — earliest boot state marker
- **`/etc/hotplug.d/net/99-oled`** — notifies oledd on link up/down
- LuCI toggle **Menu mode (oledd)** and **Menu view timeout**
- **`docs/oled-menu-implementation.md`** — phased implementation plan
- OpenWrt **`Build/Compile`** hooks in `luci-app-oled` Makefile — CI builds `/usr/bin/oled` and `/usr/sbin/oledd` for target

### Changed

- **`/etc/init.d/oled`** — skips start when `menu_mode=1` (legacy screensaver path)
- **`root/etc/uci-defaults/oled`** — enables `oledd` or `oled` based on `menu_mode`
- **`cm5-oled-debug.sh`** — reports `oledd`, `menu_mode`, and `/tmp/oled_state`
