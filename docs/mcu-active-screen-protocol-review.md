# MCU active screen — firmware / protocol / mcudd review

*2026-08-31. Target contract is **implemented in-tree** (RDCP v1, no back-compat: no `evt input` / `handle_gesture`).*

**Requirement:** the panel announces the **current screen id** when that screen changes. Host and LuCI follow that id. There is **no gesture/input command**. Panel swipe and LuCI prev/next share one wire contract.

**Live stack:** Go `/usr/sbin/mcudd` (`feeds/packages/mcudd`), ESP32 `esp32-2432S022C-router`, LuCI `luci-app-mcu-display` polling `/tmp/mcud_active_screen`. The C `mcudd-old` tree has been removed.

---

## 1. Target contract (source of truth)

The MCU owns the visible page. The host never infers the page from swipe direction.

```text
LuCI / buttons / SSH
  → FIFO prev|next|screen <id>
  → mcudd UART:  {"t":"cmd","op":"screen","data":{"screen":"<id>","dir":"…"}}
  → MCU apply_page(<id>)
  → MCU UART:    {"t":"evt","op":"screen","data":{"screen":"<id>","action":"loaded"}}
  → mcudd writes /tmp/mcud_active_screen
  → LuCI getStatus reads the file

Panel swipe / local UI
  → MCU apply_page(neighbor)
  → MCU UART:    {"t":"evt","op":"screen","data":{"screen":"<id>","action":"loaded"}}
  → mcudd writes /tmp/mcud_active_screen
  → LuCI getStatus reads the file
```

Same inbound frame in both cases: **`evt screen`**. LuCI never needs to know whether the user touched the glass or clicked Next.

Do **not** add or keep a host-side gesture command (`evt input` → `handle_gesture` → guess neighbor → write sidecar, and especially not `cmd screen` back to the panel).

---

## 2. What exists today

### 2.1 Three origins of a page change

| Origin | Who decides the new id | UART | Host sidecar |
|--------|------------------------|------|----------------|
| **LuCI Pages** / `mcud-event.sh next\|prev\|screen` / CM5 USERKEY | Host walks the page ring, sends **explicit id** | `cmd screen` | Written on matching `evt screen` ack (C), or immediately on FIFO (Go) |
| **Panel swipe** | MCU walks the ring locally | `evt input` **then** `evt screen` | C `handle_gesture` guesses neighbor from `dir`; `evt screen` may be **dropped** if it does not match a pending host cmd |
| **Unlinked announce** | MCU current page | `evt version` + `evt screen` every 2 s | C treats a different id as “not an ack” while `cmd screen` is pending |

LuCI does not talk to UART. It only writes the FIFO and polls `/tmp/mcud_active_screen`. That part is correct and should stay.

### 2.2 RDCP v1 frames involved

| Frame | Direction | Role today | Keep? |
|-------|-----------|------------|--------|
| `cmd screen` `{screen, dir}` | host → MCU | LuCI/buttons: switch page | **Yes** |
| `evt screen` `{screen, action:loaded}` | MCU → host | Ack of `cmd screen`; also swipe; also 2 s unlinked beacon | **Yes — make this the only page-sync signal** |
| `evt input` `{type:gesture, dir}` | MCU → host | Workaround so host can guess the next id if `evt screen` is ignored | **Remove from the page-sync path** |
| `cmd nav` `{dir}` | host → MCU | Firmware implements relative nav; host does not use it | Optional; prefer explicit `cmd screen` ids |
| `push hello` / `req version` / `evt version` | both | Link + version lockstep | Keep (not page sync) |
| `req metrics` | MCU → host | Pull data for the visible scope | Keep |

Wire builders: `esp32-smartdisplay-demo/src/proto/rdcp.c` (`rdcp_build_screen_evt`). Host parse: Go `feeds/packages/mcudd/internal/proto/parse.go`.

Golden traces still encode the **workaround**:

```text
# testdata/rdcp/gesture.jsonl  (host + firmware copies)
< evt input dir=left
> cmd screen router_system     ← this is the destructive echo; do not restore it
< evt screen router_system
```

The LuCI path is already the simple trace (`testdata/rdcp/screen.jsonl`):

```text
> cmd screen router_system
< evt screen router_system
```

### 2.3 Firmware (`router_engine.c`)

`apply_page()` always emits `evt screen` with the **id the MCU actually showed**. That is the right primitive.

Swipe (`router_engine_on_input`):

1. TX `evt input` (gesture dir)
2. Local `apply_page(neighbor)` which TXes `evt screen`

Host `cmd screen` (`router_engine_on_line`):

1. `apply_page(id from host)` → `evt screen`
2. Request metrics

Unlinked tick (every 2 s): TX `evt version` + `evt screen` for the current page until any host frame marks `linked`. Needed after USB flash / mcudd restart so the host learns the page; it is also what C mis-classifies as a false ack.

### 2.4 Orig C mcudd (`mcudd.c`) — live daemon

**LuCI path (keep the idea):**

- FIFO `next`/`prev` → `handle_nav` → `send_cmd_screen_dir(explicit id)`
- Pending id until **matching** `evt screen` or 2.5 s timeout
- On match: write `/tmp/mcud_active_screen`

**Swipe path (workaround):**

- `evt input` → `handle_gesture`: compute `mcudd_page_neighbor(active_screen, dir)`, write sidecar, **do not** TX `cmd screen`
- That guess is only correct if host `active_screen` already matches the MCU. After `leave_boot` (`cmd screen router_system` while the panel is already on `router_clients`) it is wrong until adopt/timeout.

**The bug that forced `evt input`:**

```c
if (screen_cmd_pending && pending_screen[0] &&
    strcmp(msg.screen, pending_screen) != 0) {
    /* ignore — not an ack */
    return 0;
}
```

A real user swipe emits `evt screen` for the **new** MCU page. If the host still has pending `router_system` from leave-boot or LuCI, that swipe event is discarded. Sidecar does not move. `evt input` was added so LuCI could update **without** trusting `evt screen`. Two events, two page rings, two clocks.

Go `mcudd` made this worse: it wrote the sidecar **and** echoed `cmd screen` on gesture, which yanks the panel. That must not return.

### 2.5 LuCI

`getStatus` → `read_active_screen()` → `/tmp/mcud_active_screen`. Poll ~1 s.

`pageControl` → `mcud-event.sh` → FIFO. No UART in rpcd. After the 2026-08-31 rpcd fix, status no longer execs the Go binary for `-dump-config`.

This is already the right split: **LuCI is a client of the sidecar**, not of gestures.

---

## 3. Why the two paths feel different

| | LuCI Next | Panel swipe (today) |
|--|-----------|---------------------|
| Who computes the next id | Host page ring | MCU page ring **and** host ring (from `evt input`) |
| MCU tells host the result | `evt screen` (if it matches pending) | `evt input` (guess) + `evt screen` (often ignored) |
| Failure mode | Pending mismatch / rate-limit | Host cursor stale; Go echo `cmd screen`; unlinked 2 s beacon vs pending |

The rings are duplicated in three trees (`pages.json`, `internal/pages/pages.go`, `router_pages.c`). Relative `dir` plus a stale host cursor cannot stay in sync. An **absolute screen id** from the MCU can.

---

## 4. Improvement: one event, one id

### 4.1 Protocol (v1 compatible)

Keep RDCP v1 JSON. Do not add a new op.

**Normative page-sync rule**

1. Whenever the MCU **changes or confirms** the visible dashboard page, it sends exactly one  
   `evt screen` with that id (`action=loaded` is fine).
2. The host **always** adopts a known `evt screen` id into `active_screen` and `/tmp/mcud_active_screen`.
3. `cmd screen` remains host-driven navigation only (LuCI, buttons, `mcud-event.sh`). The MCU still replies with `evt screen` (already does via `apply_page`).
4. **`evt input` is not part of page sync.** Stop emitting it for swipe. Host may ignore it if an old panel still sends it.
5. Unlinked 2 s `evt screen` is a **state broadcast**, not a cmd-ack. Adopting it is correct (same id is a no-op).

Optional later (not required): `evt screen` could carry `"src":"user"|"cmd"|"announce"` for logs only. LuCI should not need it.

### 4.2 Firmware

In `router_engine_on_input`:

- Drop `rdcp_build_input_evt` / TX of `evt input`.
- Keep local `apply_page(neighbor)` (already emits `evt screen`).
- Keep metrics request when linked.

Unlinked announce can stay (version + screen). After the host adopts every `evt screen`, LuCI leaves `router_boot` without `leave_boot` yanking to `router_system`.

Do not send `cmd screen` from the MCU. Do not wait for the host before applying a swipe (GPIO1/3 vs USB-C still means host TX can be dead; local apply is mandatory).

### 4.3 Orig C mcudd (live daemon)

Page sync:

- On known `evt screen`: **always** `remember_fw_screen`, update `active_screen`, `write_active_screen`. Do **not** drop the frame because `pending != got`.
- Pending is only for **outbound** rate-limit (`screen_nav_allow`): do not fire another `cmd screen` until ack **or** timeout. Pending must not filter inbound truth.
- `leave_boot`: if `last_fw_screen` is already a dashboard id, adopt it and **do not** `cmd screen router_system`.
- `handle_gesture` / `evt input`: stop using it for sidecar updates. Ignore `evt input` (log at debug). After old firmware is gone, parser can drop the op.

FIFO `next`/`prev` stay as today: compute neighbor from **current sidecar** (which now tracks MCU), send `cmd screen`, wait for `evt screen` only as rate-limit, not as a filter.

### 4.4 Go mcudd (not live)

Match the same rule: `MsgEvtScreen` → `WriteActiveScreen`; `MsgEvtInput` → no-op (already stopped echoing `cmd screen` in tree). Do not ship Go as `/usr/sbin/mcudd` on CM5 until this contract is identical and you explicitly switch.

### 4.5 LuCI

No change to `read_active_screen` / `getStatus` page fields. Polling the sidecar remains the UI. After host adopts every `evt screen`, swipe and Next both move the badge.

### 4.6 Tests / fixtures

| Change | Why |
|--------|-----|
| `gesture.jsonl` | MCU-only: swipe = `evt screen` (no `evt input`, no host `cmd screen`) |
| Host unit: `evt screen` while pending other id | Sidecar **must** update |
| Host unit: `evt input` | Must not TX `cmd screen`; must not be required for sidecar |
| Firmware host tests | Swipe emits `evt screen` only |
| `check-pages-sync.sh` | Keep rings aligned for LuCI prev/next **ids**; swipe no longer depends on host ring |

---

## 5. What not to do

- Do **not** restore host `cmd screen` on swipe (yanks the panel; LuCI desyncs).
- Do **not** add a new “gesture command” or `cmd nav` from the MCU.
- Do **not** make LuCI parse UART or `evt input`.
- Do **not** replace live C with Go until Go is the same contract and you ask for it.
- Do **not** use pending-mismatch ignore as a substitute for “unlinked beacon” handling; adopt the id, then rate-limit host TX separately.

---

## 6. Suggested implementation order

| Step | Where | Change |
|------|--------|--------|
| **P0** | Go `engine.go` | Adopt every known `evt screen`; pending only rate-limits FIFO `cmd screen`; leave_boot adopts firmware page |
| **P0** | `router_engine_on_input` | Emit `evt screen` only (via `apply_page`); remove `evt input` TX |
| **P1** | C ignore `evt input` | So mixed old/new firmware does not guess a neighbor |
| **P1** | Fixtures + C/Go/firmware unit tests | Golden path = `screen.jsonl` for both LuCI and swipe |
| **P2** | Image | Ship Go `mcudd` as `/usr/sbin/mcudd` |
| **P2** | Docs | `mcudd-commands.md` §7: swipe = same `evt screen` as cmd ack; delete gesture-as-page-sync |

CM5 USERKEY/MaskROM already go through `mcud-event.sh next/prev` (LuCI path). They automatically match the unified contract.

---

## 7. Success criteria

1. Swipe on the panel: syslog `screen evt ack: <id>` (or equivalent adopt log), `/tmp/mcud_active_screen` equals that id, LuCI Pages badge matches within one poll (~1 s). **No** `evt input` / `gesture` / `cmd screen` from the swipe.
2. LuCI Next/Prev: `cmd screen <id>` then the same `evt screen` / sidecar / badge behaviour.
3. After mcudd restart with the panel already on a dashboard page: sidecar becomes that page from the 2 s announce or first `evt screen`, **without** forcing `router_system`.
4. Host TX still dead (USB-C on GPIO1/3): swipe still changes the **panel**; once TX/RX is healthy, LuCI catches up from `evt screen` alone.

---

## 8. File map

| Tree | Files |
|------|--------|
| Firmware | `esp32-smartdisplay-demo/src/app/router_engine.c` (`on_input`, `apply_page`, unlinked tick); `src/proto/rdcp.c`; `src/router/router_app.cpp` (gesture → `on_input`) |
| Protocol traces | `esp32-smartdisplay-demo/testdata/rdcp/{screen,gesture}.jsonl` and copies under `feeds/packages/mcudd/testdata/rdcp/` |
| Host | `feeds/packages/mcudd/internal/engine/engine.go` (`MsgEvtScreen`, FIFO nav, leave-boot) |
| Go rewrite | `feeds/packages/mcudd/internal/engine/engine.go` |
| LuCI | `feeds/luci/luci-app-mcu-display/.../luci.mcu-display.uc` (`read_active_screen`); `mcud-event.sh` |
| Operator doc | [mcudd-commands.md](mcudd-commands.md) §2 (LuCI FIFO) vs §7 (current frozen swipe workaround) |

---

## 9. Verdict

The LuCI path is already the right protocol: **host names a screen, MCU shows it, MCU broadcasts that screen id**. Panel swipe is the same broadcast without a second “gesture” opcode and without the host reconstructing the ring.

## 10. Implementation (v1, no back-compat)

| Side | Change |
|------|--------|
| Firmware `router_engine_on_input` | Local `apply_page` only (emits `evt screen`). `rdcp_build_input_evt` removed. |
| Go `mcudd` | Adopt every known `evt screen`; pending only rate-limits FIFO TX. `evt input` is an unknown op. |
| Fixtures | `testdata/rdcp/gesture.jsonl` is swipe = `evt screen` only. |
| C `mcudd-old` | **Removed.** |

Live CM5 needs a **firmware flash** (no `evt input`) plus Go `mcudd` as `/usr/sbin/mcudd`.
