# mcudd command tool — FIFO, LuCI, and debug logs

Operator reference for **host → panel page navigation**. Panel swipe uses the **same** inbound frame (`evt screen`) — see §7.

Live daemon on the CM5 is Go `/usr/sbin/mcudd` (from `feeds/packages/mcudd`). The CLI that LuCI, buttons, and SSH all use is **`/usr/lib/mcud/mcud-event.sh`**.

**Related:** [mcu-display-migration-backlog.md](mcu-display-migration-backlog.md) · [mcu-uart-serial.md](mcu-uart-serial.md) (picocom/screen/socat on `ttyS2`) · skill `mcu-display-cm5` · skill `cm5-mcu-serial`

---

## 1. What to run

| Entry | Path | Who calls it |
|-------|------|----------------|
| Event CLI | `/usr/lib/mcud/mcud-event.sh` | LuCI `pageControl`, `99-mcud` buttons, net hotplug, `mcud-link-test.sh`, SSH |
| Link test | `/usr/lib/mcud/mcud-link-test.sh` | SSH / agents — ping + echo over UART |
| Daemon | `/usr/sbin/mcudd` | procd (`/etc/init.d/mcudd`) |
| LuCI RPC | `luci.mcu-display.pageControl` | **Services → MCU Display → Pages** |

FIFO (created by the daemon):

```text
/var/run/mcudd.fifo     # preferred
/tmp/mcudd.fifo         # fallback
```

Override for tests: `MCUDD_FIFO=/path mcud-event.sh next`.

Syslog tags (LuCI Debug tab tails these): **`mcudd`**, **`mcud-event`**, **`mcudd-boot`**.

```sh
logread -e mcudd -e mcud-event -e mcudd-boot | tail -n 80
```

Enable UART traces in LuCI **Configuration → Debug & logging**: `log_level=debug`, `debug=1`, `debug_serial=1`, then Save & Apply.

---

## 2. `mcud-event.sh` commands

```sh
/usr/lib/mcud/mcud-event.sh help
/usr/lib/mcud/mcud-event.sh <command> [arg]
```

| Command | FIFO line | mcudd action | UART (RDCP v1) |
|---------|-----------|---------------|----------------|
| `prev` | `prev` | neighbor of `/tmp/mcud_active_screen` with dir `right` | `cmd screen` + `"dir":"right"` |
| `next` | `next` | neighbor with dir `left` | `cmd screen` + `"dir":"left"` |
| `screen <id>` | `screen router_wifi` | jump if id is known | `cmd screen` |
| `refresh` / `net` | `refresh` / `net` | re-send current screen (or leave boot) | `cmd screen` (same id) |
| `boot` | `boot` | boot splash push | `push boot` |
| `ready` | `ready` | leave boot if sidecar is `router_boot` | `cmd screen router_system` |
| `version` | `version` | query firmware | `req version` |
| `ping` | `ping` | link probe | `req ping` |
| `echo <text>` | `echo …` | link probe | `cmd echo` |

Page order used by `prev` / `next`:

```text
router_system → router_network → router_clients →
router_storage → router_wifi → router_security → (wrap)
```

`router_boot` is not in the ring; `next`/`prev` from boot target `router_system`.

LuCI **Pages** maps 1:1:

| Button | RPC | CLI |
|--------|-----|-----|
| Previous page | `pageControl action=prev` | `mcud-event.sh prev` |
| Next page | `pageControl action=next` | `mcud-event.sh next` |
| Jump to page | `pageControl action=goto page_id=…` | `mcud-event.sh screen <id>` |
| Show boot screen | `pageControl action=boot` | `mcud-event.sh boot` |

Daemon flags (not FIFO): `mcudd -V`, `mcudd -version-json`.

---

## 3. Expected log chain (prev / next)

A working **LuCI Next** (or `mcud-event.sh next`) looks like this. Timestamps collapse to one second.

```text
mcud-event: luci pageControl next          # only when LuCI/RPC called it
mcud-event: fifo write ok event=next fifo=/var/run/mcudd.fifo
mcudd: fifo: next
mcudd: nav next: router_network -> router_clients
mcudd: uart tx: {"v":1,"t":"cmd","op":"screen","data":{"screen":"router_clients","dir":"left"}}
mcudd: cmd screen router_clients (await screen evt) pending=router_clients active=router_network
mcudd: uart rx: {"v":1,"t":"evt","op":"screen","data":{"screen":"router_clients","action":"loaded"}}
mcudd: screen evt ack: router_clients (pending matched)
```

Sidecar after that: `cat /tmp/mcud_active_screen` → `router_clients`. Panel shows the same page.

`uart tx:` / `uart rx:` / `frame type=` lines need `debug_serial=1` / `debug=1`. The `fifo:`, `nav`, `cmd screen`, `screen evt` lines are **info** and always show at default `log_level=info`.

### Physical buttons

```text
mcud-event: button wps select -> next
mcud-event: fifo write ok event=next …
```

Then the same `mcudd:` chain as above.

### Link test

```sh
/usr/lib/mcud/mcud-link-test.sh
```

Want:

```text
mcudd: req ping id=…
mcudd: link ping ok id=… uptime_ms=…
mcudd: cmd echo (await echo evt): mcud-link-test
mcudd: link echo ok: mcud-link-test
```

and `/tmp/mcud_link_test.json` with `"ping_ok":true,"echo_ok":true`.

---

## 4. Failure signatures (page nav)

| Logs | Meaning |
|------|---------|
| `fifo missing, drop event=next` | `mcudd` not running or FIFO not created |
| `fifo write failed` | FIFO present but write failed |
| `fifo: next` then **no** `nav next` | line not parsed (truncated / no newline) |
| `rate-limit next (pending=…)` | previous `cmd screen` still waiting for matching `evt screen`, or 450 ms cool-down |
| `nav next` + `cmd screen` then `screen evt ignore: got=X pending=Y` | host TX reached syslog; firmware did **not** apply Y (still announcing X) |
| `screen evt ack: X` immediately after `cmd screen Y` with X≠Y | old bug: unlinked 2 s announce treated as ack — host now logs **ignore** instead |
| `cmd screen` but **no** later `evt screen` for that id | ESP32 RX dead (USB-C still on GPIO1/3, or firmware UART re-init) |
| `nav next: router_boot -> router_system` while panel is on another page | sidecar stuck on boot; host now adopts last firmware page after ack timeout / leave_boot |
| `link test FAILED` / no `link ping ok` | host TX not reaching ESP32 — LuCI prev/next cannot move the panel |
| `screen evt ignore` looping every 2 s + `link recovery: push hello` | firmware still **unlinked** (never parsed a host frame). USB-C unplugged? Need firmware that does **not** `Serial2.end()` every 5 s |
| `gesture left/right` + `screen evt ack` | swipe path (frozen) — not LuCI prev/next |

Host → MCU is **`/dev/ttyS2` TX → ESP32 GPIO3**. MCU → host (swipe) can work while TX is dead. Unplug USB-C after flashing; tap panel RST if `grep '^2:' /proc/tty/driver/serial` RX does not climb.

---

## 5. SSH debug recipe (prev / next)

Run on the router (`root@192.168.8.1`). Do **not** `scp`.

```sh
# 0. Help + daemon
/usr/lib/mcud/mcud-event.sh help
mcudd -V
pgrep -x mcudd; ls -l /var/run/mcudd.fifo /tmp/mcud_active_screen

# 1. UART must be bidirectional
/usr/lib/mcud/mcud-link-test.sh
grep '^2:' /proc/tty/driver/serial

# 2. Capture before/after
echo BEFORE=$(cat /tmp/mcud_active_screen)
/usr/lib/mcud/mcud-event.sh next
sleep 2
echo AFTER=$(cat /tmp/mcud_active_screen)
logread -e mcudd -e mcud-event | tail -n 40

# 3. Repeat with prev and an explicit jump
/usr/lib/mcud/mcud-event.sh prev
/usr/lib/mcud/mcud-event.sh screen router_security
```

Pass: `AFTER` is the neighbor of `BEFORE`, logs show `pending matched`, panel changed.

Fail: use §4. Typical live failure is `cmd screen router_clients` followed by firmware still emitting `evt screen router_network` every 2 s (engine still **unlinked** — it never parsed a host frame).

---

## 6. FIFO handler (do not confuse with swipe)

`handleCommand()` in `feeds/packages/mcudd/internal/engine/engine.go`:

- `prev` / `next` → `navCommand()` → `cmd screen` (rate-limited)
- `screen <id>` → `sendUserScreen()`
- Pending id rate-limits another FIFO `cmd screen` until `evt screen` or 2.5 s timeout
- Every known `evt screen` updates `/tmp/mcud_active_screen` (MCU is source of truth, including swipe and unlinked 2 s announce)

LuCI `getStatus` reads `/tmp/mcud_active_screen` only. It does not send UART itself.

---

## 7. Page sync: swipe and LuCI share `evt screen`

RDCP v1 has **no gesture command**. Both directions use the same MCU broadcast:

1. Firmware swipe → local page change → `evt screen` `{screen:<id>}`
2. LuCI / FIFO prev|next|screen → mcudd `cmd screen` → MCU `apply_page` → `evt screen`
3. mcudd writes `/tmp/mcud_active_screen` from every known `evt screen`

Do **not** echo `cmd screen` from the host when the panel swipes. That yanks the panel.

See [mcu-active-screen-protocol-review.md](mcu-active-screen-protocol-review.md).
