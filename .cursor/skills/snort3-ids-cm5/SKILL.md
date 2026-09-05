---
name: snort3-ids-cm5
description: >-
  Snort 3 IDS/IPS on CM5 ImmortalWrt: luci-app-snort3, snort.init jail, generated
  Lua from UCI. Use when editing luci-app-snort3, feeds/packages/snort3, DAQ
  method (AF_PACKET/NFQ), snort.lua, or a Snort crash loop on 192.168.8.1.
---

# Snort 3 IDS on CM5

LuCI **Services → Snort IDS/IPS**. Engine `snort3` is in the CM5 image, **disabled by default**. Passive IDS on `br-lan`. Tiers: skill **`cm5-security-stack`**.

## Generated config, not snort.lua-only

`snort.uc` already `include()`s `/etc/snort/snort.lua`, then overlays HOME_NET, DAQ, interface, snaplen from UCI.

| `snort.snort.manual` | Init |
|----------------------|------|
| **`0` (required)** | `snort-mgr setup` → `/var/snort.d/snort_conf.lua` from the form |
| `1` | `snort -c …/snort.lua --tweaks local` — **ignores** Listen on / mode / method |

LuCI **always** saves `manual: false`. There is **no** “Use snort.lua only” checkbox (`snort-manual`). Do not restore it. `snort.init` default is `'manual:bool:0'`. `snort.config` ships `option manual '0'`.

## How packets are captured (`method`)

| Value | Use |
|-------|-----|
| `afpacket` | Usual watch-only IDS on the interface (`br-lan`) |
| `nfq` | Prevention only (netfilter queue). Hide unless mode is IPS |
| `pcap` | Remap to `afpacket` in core + ucode (jail-safe) |

`log_dir` `/var/log` remaps to `/var/log/snort`.

## Jail / crash loop

If `/var/snort.d/snort_conf.lua` is `root:600`, the jail cannot read it. Init must:

- `chown -R snort:snort` on `config_dir`, `temp_dir`, `log_dir`, generated conf
- `procd_add_jail_mount` config + DAQ/lua; **rw** mount `temp_dir` and `log_dir`

A DAQ `pcap` error after a conf failure is usually a fallback, not the root cause.

## LuCI UX (frozen)

- Footer Save & Apply only — no in-page save button
- No Blocky / Suricata header cross-links
- No CM5 / 2.5 GbE copy in views
- `rpc.declare` `expect: { '': {} }`; every `E('button'` has `'type': 'button'`

## Deploy

JS → `/www/luci-static/resources/view/services/snort.js`. Init → `/etc/init.d/snort` (mode `755`). After ucode edits: `ucode /tmp/luci.snort3.uc` then `/etc/init.d/rpcd restart`. Hard-refresh LuCI. Bump `PKG_RELEASE`.

## Tests

```sh
feeds/luci/luci-app-snort3/tests/run-tests.sh
```

View must **not** match `snort-manual` or `Use snort.lua only`. Must match `_('How packets are captured')` and `manual: false`.

## Do not

- Restore the snort.lua-only checkbox
- Default `manual` back to `1` in `snort.init`
- Recommend NFQ / IPS at 2.5 GbE on CM5
