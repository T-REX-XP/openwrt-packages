# OLED menu implementation plan

Maps [oled-menu.md](oled-menu.md) phases 1–4 to package layout, APIs, and CM5 constraints.

**Package:** [`feeds/luci/luci-app-oled`](../feeds/luci/luci-app-oled/)

## Phase overview

| Phase | Scope | Status |
|-------|--------|--------|
| **1** | SH1106 driver reuse, `oledd` daemon, procd, boot state file, hotplug stub, LuCI toggle | **Done (r17)** |
| **2** | libubus metrics, `network.device` / `network.interface`, bandwidth from `/sys` | **Done (r18)** |
| **3** | FIFO input, CM5 buttons, interactive menu | **Done (r19)** |
| **4** | Preinit splash polish, error states, `ubus` `oledd` control API | Planned |

## File layout (luci-app-oled)

```text
feeds/luci/luci-app-oled/
├── Makefile                    # Build/Compile → src/oled + src/oledd
├── src/
│   ├── Makefile
│   ├── I2C_Library/            # /dev/i2c-* userspace
│   ├── SSD1306_OLED_Library/   # SH1106 framebuffer + draw API
│   ├── Example_Code/           # legacy /usr/bin/oled screensaver
│   └── oledd/
│       ├── oledd.c             # Main loop + I2C init
│       ├── oledd_input.c       # FIFO event reader (Phase 3)
│       ├── oledd_menu.c        # Menu state machine + views (Phase 3)
│       ├── oledd_ubus.c        # libubus client (system, network, WiFi)
│       ├── oledd_net.c         # Port list, sysfs bandwidth rates
│       └── oledd_config.c      # UCI: menu_wifi, menu_interactive, menu_nav_button, menu_select_button
└── root/
    ├── etc/
    │   ├── config/oled         # UCI: menu_mode, menu_timeout, path, …
    │   ├── init.d/oled         # legacy screensaver (START=88)
    │   ├── init.d/oledd        # menu daemon (START=09)
    │   ├── hotplug.d/net/99-oled
    │   └── hotplug.d/button/99-oled
    ├── lib/preinit/80-oled-preinit
    └── usr/
        ├── bin/oled            # installed by Makefile
        ├── sbin/oledd
        └── lib/oled/
            ├── oled-boot-state.sh
            ├── oledd-event.sh
            ├── cm5-waveshare-rst.sh
            └── cm5-oled-debug.sh
```

## Init behaviour

| `menu_mode` | Service | Binary | START |
|-------------|---------|--------|-------|
| `0` (default) | `/etc/init.d/oled` | `/usr/bin/oled` | 88 |
| `1` | `/etc/init.d/oledd` | `/usr/sbin/oledd` | 09 |

Both respect `oled.@oled[0].enable` and UCI `path` (`/dev/i2c-7` on CM5).

### Boot state file

`/tmp/oled_state` (key=value lines):

```text
stage=network
message=ifup eth0
```

Stages: `preinit` → `boot` → `network` → `ready`.

Writers:

- `/lib/preinit/80-oled-preinit` — `preinit`
- `/etc/init.d/oledd` start — `boot`
- `/etc/hotplug.d/net/99-oled` — `network` on link events; `ready` when `eth0` or `br-lan` ifup
- Manual: `/usr/lib/oled/oled-boot-state.sh ready "System ready"`

Optional hook from network init:

```sh
/usr/lib/oled/oled-boot-state.sh network "Configuring network..."
```

## ubus API sketch (Phase 4 — not implemented)

Future `oledd` ubus object for hotplug and LuCI:

```json
// ubus call oledd status
{
  "running": true,
  "view": "ports",
  "boot_stage": "ready",
  "i2c": "/dev/i2c-7"
}

// ubus call oledd event '{"type":"net","device":"eth0","action":"ifup"}'

// ubus call oledd set_view '{"view":"system"}'
```

Phase 1 uses `/tmp/oled_state`. Phase 3 uses `/var/run/oledd.fifo` for typed input events.

## CM5 hardware constraints

Orange Pi CM5 Base + Waveshare 1.3" SH1106 HAT (FPC I2C @ **0x3c**):

| FPC pad | Function | HAT pin |
|---------|----------|---------|
| 1 | 3V3 | 1 |
| 4 | GND | 6 |
| 12 | I2C7 SDA | 3 |
| 11 | I2C7 SCL | 5 |
| 9 | RST (GPIO1_B4) | 22 |

- Default UCI `path='/dev/i2c-7'`
- RST: `cm5-waveshare-rst.sh` / `gpioset -c gpiochip1 12=1`
- **Button input** — CM5 onboard USERKEY (`wps`) and MaskROM (`BTN_2`) via `/etc/hotplug.d/button/99-oled`; UCI `menu_nav_button` / `menu_select_button`; HAT joystick GPIO deferred

## Phase 1 metrics (superseded by Phase 2)

Phase 1 used `popen("ubus call system info")` and `/sys/class/net/*/operstate`. Phase 2 replaces these with libubus and richer port data.

## Phase 2 metrics (current, r18)

| View | Data source |
|------|-------------|
| Boot | `/tmp/oled_state` |
| System | `ubus` `system` → `info` (libubus + blobmsg) — uptime, load÷65536, memory |
| Ports | `network.device` `status` for `eth0`, `eth1`, `br-lan` (up/carrier); `network.interface.{wan,lan}` `status` for IPv4; RX/TX Mbps bars from `/sys/class/net/*/statistics/{rx,tx}_bytes` |
| WiFi | `hostapd.wlan0` / `hostapd.wlan1` `get_status`, fallback `network.wireless` `status`; UCI `menu_wifi` (default `1`) |

Boot completes (`stage=ready`) when hotplug sees `eth0` or `br-lan` ifup.

## Build / CI

- **Local (host smoke test):**

  ```sh
  cd feeds/luci/luci-app-oled/src
  make clean && make CFLAGS="-O2 -Wall"
  ```

  Produces `./oled` (libconfig) and `./oledd` (libubus). Host smoke test may lack target I2C/ubus headers.

- **Dependencies (oledd):** `libubus`, `libubox`, `libblobmsg-json`

- **Feed CI:** `.github/workflows/build-packages.yml` includes `luci-app-oled`; ImmortalWrt SDK `aarch64_generic` compile installs both binaries.

- **Shell check:** `sh -n root/etc/init.d/oledd root/usr/lib/oled/*.sh root/etc/hotplug.d/net/99-oled root/etc/hotplug.d/button/99-oled`

## Phase 2 next steps

*Completed in r18 — see Phase 2 metrics above.*

## Phase 3 (done, r19)

1. **FIFO input** — `/var/run/oledd.fifo` (fallback `/tmp/oledd.fifo`); events: `net`, `up`, `down`, `ok`, `back`, `refresh`
2. **`oledd_input.c`** — create FIFO on daemon start, non-blocking poll in main loop
3. **`oledd_menu.c`** — interactive menu when UCI `menu_interactive=1` (default); auto-rotate when `0`
4. **CM5 buttons** — hotplug appends to gpio-button-hotplug (does not replace `cm5-button-scripts`)

### CM5 button mapping (two buttons, no HAT joystick)

| Physical | `BUTTON` | FIFO | List view | Detail view |
|----------|----------|------|-----------|-------------|
| USERKEY | `wps` | `ok` | Open selected item | — |
| MaskROM | `BTN_2` | `down` | Next item (wrap) | Back to menu |

Future HAT joystick: send `up` / `down` / `back` via GPIO hotplug or `oledd-event.sh`.

Menu items: **System**, **Ports**, **WiFi** (if `menu_wifi`), **Boot log**.

## Phase 4 next steps

1. Register `ubus` object `oledd` with `status`, `event`, `set_view`
2. Preinit minimal I2C splash (if safe before `i2c-7` probe)
3. Error overlays (WAN down, high load)
4. Idle dim / timeout from `menu_timeout` + wake on link loss
