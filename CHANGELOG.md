# Changelog

All notable changes to the **openwrt-packages** feed are documented here.

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

### Not yet implemented (Phase 2+)

- libubus client / `ubus` object `oledd`
- Joystick / GPIO button navigation
- WiFi/AP view, bandwidth bars, screen dimming
- Full boot-stage integration with `network` init
