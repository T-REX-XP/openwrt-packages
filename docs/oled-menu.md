Goals and constraints
Run an OLED daemon very early in boot, so it shows boot progress before networking and LuCI are ready.

Use only OpenWrt‑native APIs (ubus, UCI, /sys, /proc) and a lightweight C implementation suitable for an embedded router.

Support both passive status pages (boot progress, link status, CPU/RAM etc.) and a simple menu with icons driven by GPIO buttons on the HAT.

High‑level architecture
oledd (C daemon)

Talks to the SH1106 over I²C, maintains a framebuffer and drawing primitives.

Subscribes to system state via ubus and periodic polling of /sys and /proc.

Implements menu logic, screen layouts, and transition animations.

OpenWrt integration layer

A procd‑managed init script /etc/init.d/oledd (or cm5-oled) with USE_PROCD=1 so the daemon is supervised and restarted if it crashes.

Optional preinit hook (script in /lib/preinit or very low START priority) that shows a minimal “BOOTING…” screen before ubus is up, then hands off to oledd.

Hotplug scripts in /etc/hotplug.d/net/ and /etc/hotplug.d/ieee80211/ to send “link up/down” or “SSID changed” events to oledd over ubus or a Unix socket.

OLED daemon (C) design
Core modules
SH1106 driver

Low‑level I²C functions to send commands and data, respecting SH1106’s page‑oriented memory model.

Initializes contrast, addressing mode, and clears screen on start.

Exposes primitives: draw pixel, line, rectangle, text (using bitmap fonts), and small icons.

Framebuffer and layout engine

Keeps a 128×64 monochrome framebuffer in RAM and supports partial updates (e.g., only the status bar) to reduce I²C traffic.

Defines “views”: Boot, Ports, WiFi/AP, System, Menu. Each view has a render function fed by current metrics.

State and metrics collector

Periodic polling loop (e.g., every 500–1000 ms) calling:

ubus call system info for uptime, load (1/5/15 min), memory and swap.

ubus call system board for model name shown once or cached.

ubus call network.device status '{ "name": "eth0" }' and similar for each port to get link/carrier and basic stats.

Optional direct reads from /sys/class/net/<if>/statistics/* for high‑frequency bandwidth counters (like luci‑bwc does).

ubus call network.interface status for IP addresses, protocol, and DNS.

ubus call wireless.radio0 get or ubus call hostapd.<iface> get_status for SSID, channel, number of clients (depends on your WiFi setup).

Input handler (buttons/joystick)

Reads GPIOs wired from the HAT joystick/buttons, either via /sys/class/gpio, gpio-keys input events, or a small hotplug script on the button subsystem.

Implements a simple event queue: UP/DOWN/LEFT/RIGHT/OK/BACK.

Menu and UI controller

Maps button events to view changes and per‑view actions (e.g., long‑press to toggle detailed stats).

Manages icon selection and small animations (progress bar fill, blinking indicators).

OpenWrt boot and service integration
Early boot strategy
OpenWrt uses procd as PID 1, which runs /etc/init.d/rcS and starts enabled services in ascending START order (S10boot, S10system, S20network, etc.).

Place your service script as /etc/init.d/oledd with START=09 or similar, enable it with enable, so it starts right before boot and system (or just after them, depending on how aggressive you want early start).

If you want output even before rcS, add a preinit hook (/lib/preinit/80_oled_preinit) that:

Initializes the display and shows a static “BOOTING…” splash and maybe a spinning icon.

Exits, letting procd start the full oledd later once filesystems and ubus are available.

Init script outline
Your /etc/init.d/oledd might look like (conceptually):

USE_PROCD=1, START=09, STOP=90.

start_service() uses procd_open_instance, procd_set_param command /usr/sbin/oledd, procd_set_param respawn, and optionally stdout/stderr to log to syslog.

You can add procd_set_param netdev entries to restart or notify oledd when specific interfaces change status.

Data views and features
1. Boot progress view
Stages mapped roughly to OpenWrt init phases:

Kernel / preinit (static splash from preinit script).

S10boot: “Mounting filesystem…” progress bar.

S20network: “Configuring network…” with interface names appearing as they come up.

S95done: “System ready” badge, then automatic switch to Ports or System view.

Implementation:

The preinit script writes a tiny state file (e.g. /tmp/oled_state) which subsequent init scripts update as boot proceeds; oledd reads and visualizes that state.

Alternatively, oledd uses ubus call service list to see when key services (network, dnsmasq, hostapd) have started.

2. Ports / network connectivity view
For each LAN/WAN port: icon with link status, negotiated speed if available, and RX/TX bandwidth (e.g., small bar or numeric Mbps).

Data sources:

network.device status for up, carrier, macaddr.

/sys/class/net/<if>/statistics/rx_bytes and tx_bytes for instantaneous rate calculations.

3. WiFi / AP view
Shows SSID, channel, encryption, number of associated clients.

Data from hostapd or wireless ubus objects (hostapd.<iface>.get_status, wireless.radio0).

Optional quick indicators: WiFi on/off, WPS active, AP/Client mode.

4. System status view
CPU load (1/5/15 min), percent usage, RAM used/free, uptime, temperature (if exposed by /sys/class/thermal).

ubus call system info gives load and memory totals; convert load values by dividing by 65536 for human‑friendly numbers.

5. Menu / tools view
Simple list of “apps”:

Boot log summary (last status messages or error flag).

Network overview.

WiFi overview.

System metrics.

Config info (hostname, firmware version).

Navigation with joystick/buttons: UP/DOWN to select, OK to open, BACK to go up.

Event handling and UX
Use hotplug scripts in /etc/hotplug.d/net/ and /etc/hotplug.d/button/ to notify oledd about changes: when an interface goes up/down or a hardware button is pressed, the script calls ubus call oledd event '{...}' or writes to a FIFO that oledd watches.

Keep animations subtle and low‑bandwidth (progress bar, single blinking icon) to avoid saturating I²C; aim for 10–15 FPS max for smooth but efficient updates.

When the system is idle, dim the screen or turn it off after a timeout, with a button press or important state change (e.g. link loss) waking it up.

Implementation roadmap
Phase 1 – Driver and basic daemon

Port/implement an SH1106 C driver for OpenWrt, with simple text rendering and a fixed boot splash.

Create /etc/init.d/oledd and get the daemon supervised by procd, starting at boot.

Phase 2 – System and network metrics

Add ubus client code (libubus) to query system info, system board, network.device status, and network.interface status.

Implement the Ports and System views, updated every 0.5–1 s, reading /sys/class/net for bandwidth.

Phase 3 – Menu and inputs

Wire HAT buttons/joystick to GPIO and handle them in oledd or via hotplug scripts.

Implement menu navigation, icons, and simple animations.

Phase 4 – Early boot and polish

Add a preinit script for earliest boot splash and progress.

Integrate error states (e.g. failed WAN, no DNS, high CPU load) with clear on‑screen warnings.

Optionally expose a lightweight control API (ubus object oledd) so other services can send messages to display (e.g., VPN status).

## Implementation status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Driver, `oledd`, procd, boot state, hotplug stub | **Done** — `luci-app-oled` **r17** (2026-06-25) |
| 2 | libubus metrics, network views, bandwidth, WiFi stub | **Done** — `luci-app-oled` **r18** (2026-06-25) |
| 3 | FIFO input, CM5 buttons, interactive menu | **Done** — `luci-app-oled` **r19** (2026-06-25) |
| 4 | Preinit splash, ubus API, error states | Planned |

**Docs:** [oled-menu-implementation.md](oled-menu-implementation.md)

**Package paths:**

- Daemon: `feeds/luci/luci-app-oled/src/oledd/oledd.c` → `/usr/sbin/oledd`
- Legacy screensaver: `feeds/luci/luci-app-oled/src/Example_Code/` → `/usr/bin/oled`
- Init: `root/etc/init.d/oledd`, `root/etc/init.d/oled`
- UCI: `root/etc/config/oled` (`menu_mode`, `menu_timeout`, `menu_wifi`, `menu_interactive`)
- Input: `root/usr/lib/oled/oledd-event.sh`, `/var/run/oledd.fifo`, `/etc/hotplug.d/button/99-oled`
- Boot state: `root/usr/lib/oled/oled-boot-state.sh`, `/tmp/oled_state`

**Not yet implemented (Phase 4):** `ubus` `oledd` control object, screen dimming, error overlays, HAT joystick GPIO.