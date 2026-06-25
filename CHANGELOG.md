# Changelog

All notable changes to the **openwrt-packages** feed are documented here.

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
