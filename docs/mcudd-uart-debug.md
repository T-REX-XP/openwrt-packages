# Debug: is `mcudd` sending data on the UART?

Prove **host → panel** RDCP on Orange Pi CM5 Base. Port is **`/dev/ttyS2`** @ **115200 8N1** (CM5 UART2 / JST → ESP32 UART2 GPIO3 RX / GPIO1 TX).

Skill: **`mcu-display-cm5`**. Direct COM without the daemon: [mcu-uart-serial.md](mcu-uart-serial.md). FIFO commands: [mcudd-commands.md](mcudd-commands.md).

**Do not** open `picocom` / `screen` / `socat` on `ttyS2` while `mcudd` is running. That steals the port and makes this recipe lie.

---

## Three layers (read them in order)

| Layer | Question | Proof |
|-------|----------|--------|
| **A — userspace** | Did `mcudd` pass a line to `WriteLine`? | syslog `uart tx: {…}` |
| **B — kernel** | Did bytes leave the SoC UART? | `/proc/tty/driver/serial` line `2:` **`tx:` climbed** |
| **C — peer** | Did the ESP32 parse it? | matching `uart rx:` (`pong`, `echo`, `req metrics`) and/or `/usr/lib/mcud/mcud-link-test.sh` |

`mcudd` “sending” is **A + B**. The panel “got it” is **C**. Swipe / `evt screen` only proves **MCU → host** (the other direction).

```text
mcudd WriteLine  →  ttyS2 TX  →  ESP32 GPIO3 RX
mcudd ReadByte   ←  ttyS2 RX  ←  ESP32 GPIO1 TX
```

USB-C CH340 and the P1 JST header **share GPIO1/3**. Unplug USB-C after flash for a reliable link. Firmware can mirror inbound mcudd frames onto GPIO1 as `#rx …` for a Mac USB monitor (receive-only; see `esp32-smartdisplay-demo/docs/usb-c-rdcp-sniff.md`). If the Mac still shows `/dev/cu.usbserial-*` and `#rx` never appears, CH340 TX is fighting CM5 TX; sniff `uart tx:` in `logread` instead.

---

## 0. Enable traces

UCI section is **`mcud.main`** (not `@mcud[0]`).

```sh
uci set mcud.main.debug_serial=1
uci set mcud.main.log_level=debug
uci commit mcud
/etc/init.d/mcudd restart
```

`uart tx:` / `uart rx:` are `Debugf` and only emit when **`debug_serial=1`**. They show up in `logread` as `daemon.debug`. LuCI: **Services → MCU Display → Configuration → UART trace**.

Confirm the daemon holds the port (BusyBox image has no `fuser`):

```sh
/etc/init.d/mcudd status
pgrep -a mcudd
ls -l /proc/$(pgrep -x mcudd)/fd | grep ttyS2
# expect: … -> /dev/ttyS2

grep console= /proc/cmdline    # must be tty1 only, no console=ttyS2
pgrep -a screen; pgrep -a picocom   # must be empty
```

Kill leftovers: `killall -9 screen picocom mcudd`; then `/etc/init.d/mcudd start`.

---

## 1. Layer A — syslog `uart tx:`

```sh
logread -e mcudd | grep 'uart tx:' | tail -20
```

On start you should see, in order:

```text
uart tx: {"v":1,"t":"push","op":"boot",…}
uart tx: {"v":1,"t":"push","op":"config",…}
uart tx: {"v":1,"t":"push","op":"hello",…}
uart tx: {"v":1,"t":"req","id":1,"op":"version"}
```

Probe (does **not** change the MCU page):

```sh
/usr/lib/mcud/mcud-event.sh ping
logread -e mcudd | grep -E 'fifo: ping|req ping|uart tx:.*ping' | tail -5
```

Want:

```text
mcudd: fifo: ping
mcudd: req ping id=1
mcudd: uart tx: {"v":1,"t":"req","id":1,"op":"ping"}
```

No `uart tx:` at all → `debug_serial` is off, or `WriteLine` never ran. No `fifo: ping` → FIFO missing (`ls -l /var/run/mcudd.fifo /tmp/run/mcudd.fifo`).

Host **must not** send `cmd screen` / `cmd nav` (MCU owns paging). A healthy start log has **no** `"op":"screen"` on TX.

---

## 2. Layer B — kernel `tx:` counter

`ttyS2` is UART index **2**:

```sh
grep '^2:' /proc/tty/driver/serial
# 2: uart:16550A mmio:0xFEB50000 irq:41 tx:NNNNN rx:MMMMM fe:… brk:…
```

Before/after a ping:

```sh
grep '^2:' /proc/tty/driver/serial
/usr/lib/mcud/mcud-event.sh ping
sleep 1
grep '^2:' /proc/tty/driver/serial
```

**`tx:` must increase** (a ping frame is ~40 bytes). If A logs `uart tx:` but **`tx:` is flat**, the write never reached the 16550 (wrong fd, or a different tty).

**`rx:` climbing** while you are *not* sending is the panel talking (good for MCU→host). It does **not** prove the panel heard you.

---

## 3. Layer C — did the MCU answer?

```sh
/usr/lib/mcud/mcud-link-test.sh
cat /tmp/mcud_link_test.json
```

Pass: `"ping_ok":true` and `"echo_ok":true`, plus:

```text
uart rx: {"v":1,"t":"res","id":1,"data":{"pong":1,"uptime_ms":…}}
uart rx: {"v":1,"t":"evt","op":"echo","data":{"text":"mcud-link-test"}}
```

Linked panel on a real page also polls metrics (~1.5–2 s):

```text
uart rx: {"v":1,"t":"req","id":N,"op":"metrics","scope":"security"}
uart tx: {"v":1,"t":"res","id":N,"data":{…}}
```

Unlinked firmware (never parsed a host frame) instead announces every ~2 s:

```text
uart rx: {"v":1,"t":"evt","op":"version",…}
uart tx: {"v":1,"t":"push","op":"hello",…}     # host retry
uart rx: {"v":1,"t":"evt","op":"screen",…}    # unlinked tick
```

That pattern + A/B success = **CM5 TX not reaching ESP32 GPIO3** (USB-C still plugged, or tap panel **RST** with `mcudd` already running).

Sidecar `/tmp/mcud_active_screen` comes from **`evt screen` only**. A swipe can update it while ping still fails.

---

## Decision table

| A `uart tx:` | B `tx:` climb | C pong / echo | Meaning |
|--------------|---------------|---------------|---------|
| no | no | no | daemon not writing (`debug_serial` off, not running, FIFO dead) |
| yes | no | no | logged a write that did not hit `ttyS2` |
| yes | yes | no | **host TX is real**; MCU RX dead (USB/CH340, RST, wiring) |
| yes | yes | yes | link OK — then check metrics JSON on `uart tx:` `t":"res"` |

---

## Live snapshot (CM5, 2026-08-31)

Taken after flashing `esp32-2432S022C-router`, with **USB-C CH340 still enumerated** on the Mac (`/dev/cu.usbserial-2140`, `1A86:7523`).

| Check | Result |
|-------|--------|
| `mcudd` PID | 21590, fd 6 → `/dev/ttyS2` |
| UCI | `mcud.main.path=/dev/ttyS2`, `debug_serial=1`, `demo_mode=0` |
| cmdline | `console=tty1` only |
| Ping `uart tx:` | `{"v":1,"t":"req","id":1,"op":"ping"}` |
| Kernel `tx:` | 55522 → 55559 (+37) on ping; later +101 on ping+echo |
| Kernel `rx:` | climbing (panel TX alive) |
| `uart rx:` pong / echo | **none** |
| Unlinked announce | `evt version` + `evt screen` every 2 s; host `push hello` retry |
| Sidecar | `router_security` (swipe still reaches the host) |
| Link JSON | missing / `no_reply` |

**Verdict:** `mcudd` **is** sending on the UART (A+B). The ESP32 is **not** receiving host frames (C) because USB-C still drives GPIO1/3. Unplug USB-C, keep `mcudd` running, tap **RST** if `rx:` stalls.

---

## One-shot SSH recipe

```sh
ssh -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 '
  echo "=== process ==="
  pgrep -a mcudd || { echo "mcudd not running"; exit 1; }
  ls -l /proc/$(pgrep -x mcudd)/fd | grep ttyS2
  echo "=== serial before ==="
  grep "^2:" /proc/tty/driver/serial
  /usr/lib/mcud/mcud-event.sh ping
  sleep 2
  echo "=== serial after ==="
  grep "^2:" /proc/tty/driver/serial
  echo "=== uart lines ==="
  logread -e mcudd | grep -E "uart tx:|uart rx:|req ping|fifo: ping" | tail -24
'
```

Then, with USB-C **unplugged**:

```sh
ssh -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 /usr/lib/mcud/mcud-link-test.sh
```
