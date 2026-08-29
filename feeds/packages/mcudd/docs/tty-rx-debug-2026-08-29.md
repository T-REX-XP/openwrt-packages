# TTY RX debug — mcudd vs ESP32 firmware

**Date:** 2026-08-29  
**Scope:** Why `mcudd` appears unable to read UART data, compared with
`esp32-smartdisplay-demo/src/main.cpp` (TX beacon stub) and the production
RDCP peer (`src/router/*`).  
**Live router:** Orange Pi CM5 Base, `192.168.8.1`, `/dev/ttyS2` @ 115200 8N1.

## Verdict

`mcudd` **can read ttyS2**. Kernel RX and `debug_serial` logs both show a
newline-framed pong every 1 s from the panel.

What fails is the **RDCP session**, not the UART byte path:

| Check | Result |
|-------|--------|
| Kernel `ttyS2` RX counter climbing | Yes (`rx` +~190 B / 3 s while beacons run) |
| `mcudd` `uart rx:` of beacon JSON | Yes |
| `/tmp/mcud_link_test.json` `ping_ok` | True (see caveat below) |
| `echo_ok` | **False** — stub never replies to `cmd echo` |
| `evt screen` / leave-boot | **Never** — active screen stuck on `router_boot` |
| `/tmp/mcud_firmware_version.json` | **Stale** (release 44 from earlier full firmware) |

The flashed firmware is the **TX beacon stub** in `src/main.cpp`, not the
`esp32-2432S022C-router` peer. Host link-test and page nav cannot succeed
against that stub. Several host-side bugs then make the failure look like
“UART RX is dead.”

---

## Live snapshot (CM5)

Taken while `mcudd` PID 30224 (`1.0.0+47`) owned `/dev/ttyS2`.

```text
cmdline: console=tty1 earlycon=uart8250,mmio32,0xfeb50000 ...
         (no runtime console=ttyS2 — good)

mcud.main.path='/dev/ttyS2'
mcud.main.baud='115200'
mcud.main.debug_serial='1'
mcud.main.enable='1'

/proc/tty/driver/serial ttyS2 (uart2 @ 0xFEB50000):
  tx:~49k  rx:~114k  fe:129  brk:13  RTS|DTR   ← DTR/RTS still asserted

/tmp/mcud_state          stage=ready
/tmp/mcud_active_screen  router_boot
/tmp/mcud_link_test.json ping_ok=true ping_id=4 echo_ok=false
/tmp/mcud_firmware_version.json  release=44 synced=false  (not updated by stub)
```

Typical log cadence (every 1 s RX, every 2 s host retry):

```text
uart rx: {"v":1,"t":"res","id":35,"data":{"pong":1,"uptime_ms":34529}}
uart tx: {"v":1,"t":"push","op":"boot",...}
uart tx: {"v":1,"t":"cmd","op":"screen","data":{"screen":"router_system","dir":"left"}}
rate-limit cmd screen router_system (pending=router_system age=2003ms)
```

ESP32 reset is visible on the same UART (boot ROM + Arduino INFO lines), then
beacons resume from `id=1`. `mcudd` parses those as `ignored line: invalid json`.

---

## What each side actually does

### Firmware now on the panel — `src/main.cpp` TX beacon

This file is a **path-check stub**. It replaced the `#ifdef ROUTER_UI` main
that used to call `rdcp_transport_begin()` + `router_app_init()`.

```text
setup()
  Serial.begin(115200)          UART0 default pins GPIO3 RX / GPIO1 TX
  smartdisplay_init()           Arduino INFO logs also go out Serial
  send one pong

loop()
  accumulate Serial bytes, show last line on LVGL (no RDCP parse)
  every 1s: println({"v":1,"t":"res","id":N,"data":{"pong":1,"uptime_ms":M}})
```

It does **not**:

- answer `req ping` with the host’s `id`
- emit `evt echo` / `evt version` / `evt screen`
- request metrics or leave the boot screen
- call `Serial.end()` before using UART2 (the production recipe)

`platformio.ini` still has `default_envs = esp32-2432S022C` (upstream demo).
The production env `esp32-2432S022C-router` compiles `router/` **and** this
`main.cpp`. Because `main.cpp` no longer has `#ifdef ROUTER_UI`, a router
build now runs the beacon stub and **never enters** `router_app_*`.

Backup of the real entrypoint: `src/main.cpp.bak-full-ui`.

### Production firmware — `src/router/` (not running)

This is the peer `mcudd` was written against.

| Host frame | Firmware action (`router_app.cpp`) |
|------------|-------------------------------------|
| `req ping` | `res` `{pong, uptime_ms}` with **same `id`** |
| `cmd echo` | `evt echo` with `data.text` |
| `req version` / `push hello` | `evt version` (`stack`/`release`/`rdcp`) |
| `cmd screen` | switch LVGL page + `evt screen` (`action=loaded`) |
| `req metrics` | MCU originates these; host replies `res` |

Transport (`rdcp_transport.cpp` + `-D RDCP_TRANSPORT_UART2`):

- `HardwareSerial(2)` remapped to **GPIO3 RX / GPIO1 TX** (P1 JST).
- GPIO16/17 are LCD DC/CS on 2432S022C — **not** UART.
- Production `setup()` **must** `Serial.end()` UART0 before UART2 takes those
  pins. Comment in the backup: otherwise host/MCU RX drops frames.

### Host — `mcudd` Go daemon

Startup TX (unchanged from C): `push boot` → `push config` → `push hello` →
`req version` → `LeaveBoot()` if `/tmp/mcud_state` is `stage=ready`.

RX dispatch (`internal/daemon/engine.go`):

- any `res` whose raw line contains `"pong"` → `MsgResPing` → `ping_ok=true`
- `evt echo` → `echo_ok=true`
- `evt screen` → clear nav pending, write `/tmp/mcud_active_screen`
- `evt version` → `/tmp/mcud_firmware_version.json`

Line I/O: raw `unix.Open` + `poll(2)` (`internal/transport/serial_linux.go`,
`internal/run/loop_linux.go`). Uncommitted local changes split UART RX onto
its own goroutine and log via syslog (not procd stdout).

---

## Issues

### F1 — Flashed image is not an RDCP peer (firmware, primary)

`main.cpp` is a one-way beacon. `mcud-link-test.sh` requires **both**
`ping_ok` and `echo_ok`. Echo can only come from `router_app.cpp` `op=echo`.
Screen nav can only leave `router_boot` after `evt screen`.

**Fix:** restore `#ifdef ROUTER_UI` main (from `main.cpp.bak-full-ui`) and
flash `pio run -e esp32-2432S022C-router -t upload`. Keep the beacon as
`esp32-2432S022C-txbeacon` only. Unplug USB-C after flash (shared GPIO1/3).

### F2 — Production main is currently broken (firmware)

Until F1 is restored, **every** env that compiles this `main.cpp` is a
beacon, including `-router`. `router_app.cpp` / `rdcp_transport.cpp` are
dead code at runtime.

### F3 — Arduino logs share the RDCP UART (firmware)

`platformio.ini` sets `CORE_DEBUG_LEVEL=ARDUHAL_LOG_LEVEL_INFO`.
`smartdisplay_init()` prints DMA/touch lines on `Serial`. Live capture:

```text
uart rx: [   484][I][esp32_smartdisplay_dma.c:278] ...
ignored line: invalid json
uart rx: {"v":1,"t":"res","id":1,"data":{"pong":1,"uptime_ms":529}}
```

Production backup turns this off (`Serial.setDebugOutput(false)` +
`Serial.end()`) before UART2 RDCP. The stub does not.

**Fix (router build):** keep debug off on GPIO1/3; use USB only when JST is
disconnected.

### F4 — UART0 vs UART2 on the same pins (firmware)

| Build | UART | Pins |
|-------|------|------|
| TX beacon | `Serial` (UART0) | GPIO3/1 |
| Router env | `HardwareSerial(2)` | remapped to GPIO3/1 |

Both are electrically the JST header. They must not be `begin()`’d together.
The backup `Serial.end()` exists specifically so UART2 can own the pins.
Docs in `openwrt-packages/docs/oled-mcu-display-backlog.md` still say
GPIO16/17 — that is **wrong** for 2432S022C.

### F5 — Stub RX is display-only (firmware)

Host TX is real (`push boot`, `cmd screen` every ~2 s). The stub increments
`rx_count` and paints the line but never calls `router_app_on_serial_line()`.
Panel `RX#` is the only check that CM5→ESP32 wiring works. Link-test cannot
prove it.

### H1 — Leave-boot storm looks like a stuck UART (mcudd)

`/etc/init.d/mcudd` writes `stage=ready` into `/tmp/mcud_state`. The 2 s
idle tick then calls `LeaveBoot()` forever while `ActiveScreen == router_boot`.

```text
LeaveBoot() → SendScreen(router_system)
  → no evt screen (stub)
  → Nav.Pending stays true for AckTimeout (2.5 s)
  → next tick: rate-limit, then send again
```

Logs fill with `cmd screen` / `rate-limit` even though RX is healthy.
`/tmp/mcud_active_screen` stays `router_boot`.

**Fix:** stop retrying leave-boot after N failures or until a version/pong
proves a capable peer; do not treat “no screen ack” as “no UART RX.”

### H2 — `ping_ok` is a false positive (mcudd)

`rdcp.Parse` classifies **any** `t=res` line containing the substring
`"pong"` as `MsgResPing`. It does not check `id` against `PingReqID`.

The beacon’s unsolicited `id=1,2,3,…` therefore sets `ping_ok=true`.
`mcud-link-test.sh` can pass ping and still fail echo, which reads as
“half-duplex / RX broken.”

**Fix:** require `msg.ReqID == e.PingReqID` (or accept unsolicited pongs
only as `link_alive`, not as link-test ping).

### H3 — Historical “kernel RX climbs, userspace does not” (mcudd)

Comments and uncommitted diffs document a real Go/OpenWrt failure mode:

1. `os.OpenFile` registered the UART with the Go **netpoller**, which can
   steal `POLLIN` from `unix.Poll`.
2. UART + FIFO in one `poll()`; FIFO/procd activity delayed UART reads.
3. `procd_set_param stdout/stderr 1` + `fmt.Printf` **blocked** the poll
   loop when logd back-pressured.

Mitigations already in tree / on the router:

- raw `unix.Open` (not `os.File`)
- UART reader goroutine vs FIFO poll
- init script no longer attaches procd stdio (running PID has fd 1/2 → `/dev/null`)
- logger uses syslog

The live process **is** consuming RX (`uart rx:` once per second, `rx`
sysfs climbing). Treat H3 as **fixed on this unit**; keep the raw-fd design.

### H4 — `TIOCMSET` ioctl is the wrong helper (mcudd)

```go
status, err := unix.IoctlGetInt(fd, unix.TIOCMGET)   // pointer — OK
status &^= unix.TIOCM_DTR | unix.TIOCM_RTS
_ = unix.IoctlSetInt(fd, unix.TIOCMSET, status)      // value, not *int — WRONG
```

`TIOCMSET` needs a pointer (`unix.IoctlSetPointerInt`). `TCFLSH` correctly
uses `IoctlSetInt`. Live `ttyS2` still shows `RTS|DTR`. On the native 16550
this is mostly cosmetic; on a USB-UART adapter it can **hold ESP32 in reset**
or glitch EN — the reason C `mcudd_serial.c` clears DTR/RTS.

C also uses `cfmakeraw` + `VTIME=1` + `tcdrain` after write. Go uses
hand-rolled raw flags, `VTIME=0`, and dropped `tcdrain`. None of these
explain the current successful RX; fix H4 before relying on USB serial.

### H5 — Earlycon framing garbage on the same UART (platform)

`earlycon=uart8250,mmio32,0xfeb50000` **is** UART2 / ttyS2 (1.5 Mbaud).
`fe:129` / `brk:13` match boot-time baud mismatch plus ESP32 resets.
Runtime `console=tty1` only — mcudd owns the port after Linux is up.
ESP32 must ignore non-JSON until the first valid frame (production firmware
already does).

### H6 — Stale sidecars after stub flash (host + firmware)

Version sidecar from 18:08 (full FW release 44) is never overwritten by the
beacon. LuCI can show “firmware 44, not synced” while the panel is a stub.
Clear `/tmp/mcud_firmware_version.json` on mcudd start if no version evt
arrives within N seconds.

---

## Sequence that looks like “cannot read TTY”

```text
ESP32 stub  --pong/s-->  ttyS2  --read-->  mcudd  (WORKS)
mcudd       --cmd screen / push boot-->  ESP32 stub  (bytes sent; no RDCP reply)
mcudd       waits for evt screen                 (never)
LeaveBoot   retries every 2 s                    (log storm)
link-test   ping_ok=true (H2), echo_ok=false     (script FAIL)
```

MCU→host bytes are fine. Host→MCU bytes are likely fine too (confirm
`RX#` on the panel). The protocol peer is missing.

---

## Recommended order of work

1. **Firmware:** restore `ROUTER_UI` main from `main.cpp.bak-full-ui`; flash
   `esp32-2432S022C-router`; unplug USB-C; confirm panel `LINK OK`.
2. **Host:** match ping `id`; stop leave-boot after timeout; use
   `IoctlSetPointerInt` for `TIOCMSET`.
3. **Verify:** `/usr/lib/mcud/mcud-link-test.sh` → `ping_ok` + `echo_ok`;
   `/tmp/mcud_active_screen` leaves `router_boot`; version sidecar matches
   `mcud-version.json` (release 47).
4. Keep `esp32-2432S022C-txbeacon` as a **one-way** UART smoke test only.
   Do not use it as the default `main.cpp`.

### Quick live commands

```sh
# MCU → host still flowing?
grep '^2:' /proc/tty/driver/serial
logread -e mcudd | grep 'uart rx:' | tail -5

# Link test (needs full firmware)
/usr/lib/mcud/mcud-link-test.sh
cat /tmp/mcud_link_test.json /tmp/mcud_active_screen /tmp/mcud_firmware_version.json
```

---

## File map

| Path | Role |
|------|------|
| `esp32-smartdisplay-demo/src/main.cpp` | TX beacon stub (currently flashed) |
| `esp32-smartdisplay-demo/src/main.cpp.bak-full-ui` | Real `ROUTER_UI` setup/loop |
| `esp32-smartdisplay-demo/src/router/rdcp_transport.cpp` | UART2 @ GPIO3/1 |
| `esp32-smartdisplay-demo/src/router/router_app.cpp` | ping/echo/version/screen |
| `feeds/packages/mcudd/internal/transport/serial_linux.go` | termios + read/write |
| `feeds/packages/mcudd/internal/run/loop_linux.go` | UART goroutine + FIFO poll |
| `feeds/packages/mcudd/internal/rdcp/parse.go` | `"pong"` substring → ping |
| `feeds/packages/mcudd/internal/daemon/engine.go` | startup + leave-boot + RX |
| `feeds/luci/luci-app-mcu-display/root/usr/lib/mcud/mcud-link-test.sh` | ping + echo acceptance |
| `feeds/packages/mcudd-old/src/mcudd/mcudd_serial.c` | C reference (DTR/RTS, `tcdrain`) |
