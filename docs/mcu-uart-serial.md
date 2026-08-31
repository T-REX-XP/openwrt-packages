# MCU UART serial on CM5 (`/dev/ttyS2`)

Talk to the ESP32 panel **directly on the COM port** from the router, bypassing `mcudd`. Firmware image packages: **`picocom`**, **`screen`**, **`socat`**.

**Is `mcudd` actually writing the UART?** Do not open this port — use [mcudd-uart-debug.md](mcudd-uart-debug.md) (`uart tx:` + kernel `tx:` + link test).

Skill: **`cm5-mcu-serial`**. While `mcudd` is running, use [mcudd-commands.md](mcudd-commands.md) (`mcud-event.sh`, `mcud-link-test.sh`).

## Why three tools

| Package | Size (apk) | Role |
|---------|------------|------|
| **picocom** | ~23 KiB | **Preferred** interactive serial terminal. Purpose-built, easy exit, no leftover sessions. |
| **screen** | ~177 KiB + ncurses | Familiar multiplexer. Easy to **detach** and leave `ttyS2` busy — kill leftover sessions. |
| **socat** | ~131 KiB | Scripted / agent one-shot (no TTY). Send one RDCP line, read the reply, exit. |

**Not in the image:** `minicom` (heavier TUI; picocom covers the same job). BusyBox `microcom` is not enabled.

LuCI **Terminal** (`ttyd`, already on CM5) can run `picocom` in the browser after `mcudd` is stopped.

## Port and protocol

| Item | Value |
|------|--------|
| Device | `/dev/ttyS2` (CM5 UART2, debug header / JST) |
| Line | **115200 8N1**, no flow control |
| Framing | RDCP v1: one JSON object, terminated by `\n` (`0x0A`) |
| Kernel console | Must **not** be on `ttyS2` (`/proc/cmdline` → `console=tty1` only) |

```text
CM5 ttyS2  <── 115200 8N1 ──>  ESP32 UART2 (GPIO3 RX / GPIO1 TX)
```

USB-C CH340 and the P1 JST header **share GPIO1/3**. Unplug USB-C before using the router port for a live link. Host USB serial (`/dev/cu.usbserial-*`) can receive MCU JSON plus `#rx` copies of mcudd payloads (receive-only; firmware `docs/usb-c-rdcp-sniff.md`). Skill `esp32-cm5-router-fw`.

## Exclusive lock

`mcudd` owns `/dev/ttyS2` in production. Opening picocom/screen/socat on the same node garbles RDCP or fails with “Device or resource busy”.

```sh
/etc/init.d/mcudd stop
# … serial session …
/etc/init.d/mcudd start
```

Check who holds the port:

```sh
fuser /dev/ttyS2
pgrep -a mcudd
pgrep -a picocom
screen -ls
```

## picocom (recommended)

```sh
ssh -t -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 \
  'picocom -b 115200 /dev/ttyS2'
```

On the router (or LuCI Terminal):

```sh
/etc/init.d/mcudd stop
picocom -b 115200 /dev/ttyS2
```

| Key | Action |
|-----|--------|
| **Ctrl-A Ctrl-X** | Exit (then start `mcudd`) |
| **Ctrl-A Ctrl-C** | Local break |
| **Ctrl-A Ctrl-Q** | Toggle local echo (useful while typing JSON) |

Type a full RDCP line and press Enter. Example ping:

```text
{"v":1,"t":"req","id":1,"op":"ping"}
```

Reply looks like `{"v":1,"t":"res","id":1,"data":{…pong…}}`.

Useful flags: `-q` quieter banner; `--imap lfcrlf` only if the panel expects CRLF (stock RDCP is LF).

## screen

```sh
ssh -t -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 \
  'screen /dev/ttyS2 115200'
```

| Key | Action |
|-----|--------|
| **Ctrl-A k**, then **y** | Kill this window and exit |
| **Ctrl-A \\** | Quit screen |
| **Ctrl-A d** | Detach — **avoid**; session keeps the UART |

If a session was left behind:

```sh
screen -ls
screen -X -S <name-or-pid> quit
fuser -k /dev/ttyS2    # last resort; then start mcudd
```

## socat (scripts and agents)

No TTY required. `-T3` drops the connection after 3 s idle so the command cannot hang.

```sh
/etc/init.d/mcudd stop

printf '%s\n' '{"v":1,"t":"req","id":1,"op":"ping"}' \
  | socat -T3 - /dev/ttyS2,b115200,raw,echo=0,igncr

printf '%s\n' '{"v":1,"t":"req","id":2,"op":"version"}' \
  | socat -T3 - /dev/ttyS2,b115200,raw,echo=0,igncr

/etc/init.d/mcudd start
```

Do **not** add `crnl` unless you know the firmware wants CR+LF; RDCP is newline-only.

Agents must not start unbounded `picocom`/`screen` (no PTY / hangs the tool). Use socat with `-T`, or ask the user to run picocom locally.

## Sample RDCP lines

Same frames `mcudd` sends (`feeds/packages/mcudd/internal/proto/build.go`):

```text
{"v":1,"t":"req","id":1,"op":"ping"}
{"v":1,"t":"req","id":2,"op":"version"}
{"v":1,"t":"cmd","op":"echo","data":{"text":"hi"}}
```

Swipe JSON from the panel is inbound `evt screen` only. Host adopts that id into the sidecar; do not echo `cmd screen`. Skill `mcu-display-cm5`.

## Hardware checks

```sh
grep console= /proc/cmdline          # tty1 only — no ttyS2
ls -l /dev/ttyS2
grep '^2:' /proc/tty/driver/serial   # rx must climb when the panel TX is live
logread -e mcudd | tail -20
```

No RX after a USB flash: unplug USB-C, tap panel **RST**, start `mcudd`.

## Image vs live install

CM5 `DEVICE_PACKAGES` in `immortalwrt` `target/linux/rockchip/image/armv8.mk` includes `picocom screen socat` (plus `openssh-sftp-server` for host `scp`). After sysupgrade they are on-router.

On a running box without a rebuild, install the same apks from ImmortalWrt snapshots `aarch64_generic/packages/` (needs `libncurses6` / `terminfo` for `screen` — already present with `ttyd`). Router `apk update` may fail if WAN wget is blocked; copy the `.apk` with `scp` and `apk add --allow-untrusted ./pkg.apk`.
