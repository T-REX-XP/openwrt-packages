---
name: openwrt-25x
description: >-
  OpenWrt / ImmortalWrt 25.x application stack: apk (.apk) instead of opkg/.ipk,
  native ucode rpcd with ucode-mod-uci, ucode-mod-fs, and rpcd-mod-ucode, plus
  ucode -c syntax checks. Use when writing feed packages, LuCI RPC, install or
  QA commands, hooks, or when the user mentions OpenWrt 25, apk, opkg, .ipk,
  ucode, or /usr/libexec/rpcd.
---

# OpenWrt 25.x stack

Target: ImmortalWrt **25.12** (`rockchip/armv8` → `aarch64_generic`).

## apk, not opkg

| Old (pre-25) | 25.x |
|--------------|------|
| `opkg update` | `apk update` |
| `opkg install pkg` | `apk add pkg` |
| `opkg remove pkg` | `apk del pkg` |
| `opkg info pkg` | `apk info pkg` |
| `opkg reinstall pkg` | `apk add -u --force-reinstall pkg` |
| `.ipk` artifacts | `.apk` artifacts |

Do not document `opkg` in Makefiles, LuCI copy, tests, or QA.

## Native ucode RPC

Do **not** add new LuCI backends as shell or Lua plugins in `/usr/libexec/rpcd/`.

```text
htdocs/luci-static/resources/view/<area>/<app>.js
root/usr/share/rpcd/ucode/luci.<app>.uc    # rpcd-mod-ucode
root/usr/share/rpcd/acl.d/luci-app-<app>.json
root/usr/share/luci/menu.d/luci-app-<app>.json
```

In `.uc` plugins:

```ucode
'use strict';
import * as uci from 'uci';
import * as fs from 'fs';
```

Modules: **`ucode-mod-uci`**, **`ucode-mod-fs`**, loaded by **`rpcd-mod-ucode`**.

Helpers **above** callers (`'use strict'` does not hoist). No `{` `}` in regex or interpolated strings — use `chr(123)` / `chr(125)`. Rule **`rpcd-ucode-strict`**.

`rpc.declare` always `expect: { '': {} }`.

## Syntax check

1. After editing `.uc`, run **`ucode -c path/to/file.uc`** (compile, no execute) when `ucode` is available.
2. On the CM5 (usual on macOS hosts): `scp` → `ucode -c /tmp/file.uc` (exit 0) → copy to `/usr/share/rpcd/ucode/` → `/etc/init.d/rpcd restart`.
3. Project hook `.cursor/hooks.json` runs the same `ucode -c` after Agent edits when the binary exists.

## Kernel

OpenWrt **25.x** default kernel is **6.12**. This feed does not set it. Sibling **immortalwrt** CM5 `rockchip` uses **`KERNEL_PATCHVER:=6.18`** — do not change that to 6.12.

## Related

- Packages: **`openwrt-feed-packages`**
- Live router apk/UCI: **`openwrt-mcp-ssh`**
- LuCI JS/CSS: **`luci-bootstrap-theming`**
