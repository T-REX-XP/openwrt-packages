# OLED menu implementation plan

Maps [oled-menu.md](oled-menu.md) phases 1–4 to package layout, APIs, and CM5 constraints.

**Package:** [`feeds/luci/luci-app-oled`](../feeds/luci/luci-app-oled/)

## Phase overview

| Phase | Scope | Status |
|-------|--------|--------|
| **1** | SH1106 driver reuse, `oledd` daemon, procd, boot state file, hotplug stub, LuCI toggle | **Done (r17)** |
| **2** | libubus metrics, `network.device` / `network.interface`, bandwidth from `/sys` | Planned |
| **3** | HAT joystick/GPIO input, menu navigation, icons | Planned |
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
│       └── oledd.c             # Phase 1 menu daemon
└── root/
    ├── etc/
    │   ├── config/oled         # UCI: menu_mode, menu_timeout, path, …
    │   ├── init.d/oled         # legacy screensaver (START=88)
    │   ├── init.d/oledd        # menu daemon (START=09)
    │   └── hotplug.d/net/99-oled
    ├── lib/preinit/80-oled-preinit
    └── usr/
        ├── bin/oled            # installed by Makefile
        ├── sbin/oledd
        └── lib/oled/
            ├── oled-boot-state.sh
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
- `/etc/hotplug.d/net/99-oled` — `network` on link events
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

Phase 1 uses `/tmp/oled_state` and `/tmp/oled_net_changed` instead.

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
- **Button input deferred** — use CM5 **USERKEY** (`cm5-button-scripts`) or Phase 3 HAT joystick GPIO

## Phase 1 metrics (current)

| View | Data source |
|------|-------------|
| Boot | `/tmp/oled_state` |
| System | `popen("ubus call system info")` — uptime, load÷65536, memory |
| Ports | `/sys/class/net/{eth0,eth1,br-lan}/operstate` |

## Build / CI

- **Local (host smoke test):**

  ```sh
  cd feeds/luci/luci-app-oled/src
  make clean && make CFLAGS="-O2 -Wall"
  ```

  Produces `./oled` and `./oledd` linked against host `libconfig` (router image uses target SDK).

- **Feed CI:** `.github/workflows/build-packages.yml` includes `luci-app-oled`; ImmortalWrt SDK `aarch64_generic` compile installs both binaries.

- **Shell check:** `sh -n root/etc/init.d/oledd root/usr/lib/oled/*.sh root/etc/hotplug.d/net/99-oled`

## Phase 2 next steps

1. Replace `popen` JSON parsing with **libubus** + **libblobmsg-json**
2. Add `network.device status` and `network.interface status` for IPs and carrier
3. RX/TX rate bars from `/sys/class/net/*/statistics/{rx,tx}_bytes`
4. Call `oled-boot-state.sh ready` from `network` `service_started` or `S95done` equivalent
5. WiFi view stub (`hostapd.*` / `wireless.radio0`) behind feature flag

## Phase 3 next steps

1. Map HAT joystick to GPIO or `gpio-keys` / `button-hotplug`
2. Event queue in `oledd` (UP/DOWN/OK/BACK)
3. Menu list view and per-screen drill-down
4. `ubus call oledd event` or FIFO watcher (replace `/tmp/oled_net_changed` touch)

## Phase 4 next steps

1. Register `ubus` object `oledd` with `status`, `event`, `set_view`
2. Preinit minimal I2C splash (if safe before `i2c-7` probe)
3. Error overlays (WAN down, high load)
4. Idle dim / timeout from `menu_timeout` + wake on link loss
