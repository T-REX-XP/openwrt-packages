---
name: cm5-mcu-serial
description: >-
  Talk to the Orange Pi CM5 MCU display over the router serial port /dev/ttyS2
  (RDCP v1 newline JSON at 115200 8N1). Use when opening picocom, screen, or
  socat on the COM port, sending RDCP by hand, debugging a silent ESP32 panel,
  or the user mentions serial terminal, ttyS2, or talking to the MCU without mcudd.
---

# CM5 MCU serial (router COM port)

ESP32 panel on **CM5 UART2** = `/dev/ttyS2` @ **115200 8N1**. Protocol is **RDCP v1** (one JSON object per line, `\n`).

**Preferred interactive tool:** `picocom` (small, built for serial). **`screen`** is also in the image. **`socat`** is for one-shot / agent use (no TTY).

Full operator notes: [docs/mcu-uart-serial.md](../../../docs/mcu-uart-serial.md). Host daemon path: skill **`mcu-display-cm5`**. USB flash on the Mac: **`esp32-cm5-router-fw`**.

## Exclusive owner

Only **one** writer may hold `ttyS2`:

| Owner | When |
|-------|------|
| `mcudd` | Normal: LuCI, buttons, swipe sidecar |
| `picocom` / `screen` / `socat` | Direct COM debug |
| Mac USB-C CH340 | Flash / host serial monitor — **unplug** before using JST/`ttyS2` |

Always:

```sh
ssh -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 '/etc/init.d/mcudd stop'
# confirm USB-C unplugged; JST UART connected
# … use picocom / screen / socat …
ssh -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 '/etc/init.d/mcudd start'
```

Kernel cmdline must **not** include `console=ttyS2` (`grep console= /proc/cmdline` → `console=tty1` only).

## Which tool

| Need | Tool | Command |
|------|------|---------|
| Human SSH / LuCI **Terminal** (ttyd) | **picocom** | `picocom -b 115200 /dev/ttyS2` |
| Human who prefers GNU screen | **screen** | `screen /dev/ttyS2 115200` |
| Agent / script (no TTY) | **socat** | one-shot RDCP line (below) |
| mcudd already running | **do not** open the port | `/usr/lib/mcud/mcud-link-test.sh` |

Skip **minicom** (not in the image). Do not leave **`screen` detached** — it keeps the port.

## Agent rules

- Do **not** start unbounded `picocom`/`screen` from this session (hangs the shell).
- Use **socat** with a timeout, or tell the user to run picocom over `ssh -t`.
- After probing, **start mcudd** again unless the user is still on the port.
- Prefer link-test while mcudd is up: `/usr/lib/mcud/mcud-link-test.sh`.

### Socat ping (mcudd stopped)

```sh
ssh -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 '
  /etc/init.d/mcudd stop
  printf "%s\n" "{\"v\":1,\"t\":\"req\",\"id\":1,\"op\":\"ping\"}" \
    | socat -T3 - /dev/ttyS2,b115200,raw,echo=0,igncr
  /etc/init.d/mcudd start
'
```

Expect a `t":"res"` line with the same `id` and `pong` in `data`.

### Picocom (human, allocate TTY)

```sh
ssh -t -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 'picocom -b 115200 /dev/ttyS2'
```

Exit: **Ctrl-A** then **Ctrl-X**. Type one RDCP line and Enter, e.g. `{"v":1,"t":"req","id":1,"op":"ping"}`.

### Screen

```sh
ssh -t -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 'screen /dev/ttyS2 115200'
```

Exit: **Ctrl-A** then **k**, confirm **y**. If a session was left behind:

```sh
ssh -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 'screen -ls; screen -X -S mcu quit; fuser /dev/ttyS2'
```

## Hardware

```text
CM5 ttyS2 TX/RX  ← JST →  ESP32 UART2 GPIO1 TX / GPIO3 RX
```

USB-C and JST share GPIO1/3. Stuck RX (`grep '^2:' /proc/tty/driver/serial` not climbing): unplug USB-C, tap panel **RST**, start mcudd.

## Related

- [docs/mcu-uart-serial.md](../../../docs/mcu-uart-serial.md)
- [docs/mcudd-commands.md](../../../docs/mcudd-commands.md) — FIFO/`mcud-event.sh` while mcudd runs
