# luci-app-snort3 — upstream notes

Vendored from [dddavid51/luci-snort3-openwrt](https://github.com/dddavid51/luci-snort3-openwrt) (GPL-2.0-or-later).

## Version

- **Upstream tag:** v3.6 (November 2025)
- **Feed package:** `PKG_VERSION:=3.6`, `PKG_RELEASE:=1`

## ImmortalWrt packaging

| Upstream path | Feed path |
|---------------|-----------|
| `src/controller/snort.lua` | `luasrc/controller/snort.lua` |
| `src/model/cbi/snort/config.lua` | `luasrc/model/cbi/snort/config.lua` |
| `src/view/snort/*.htm` | `luasrc/view/snort/*.htm` |
| `src/i18n/snort.en.po` | `po/en/snort.po` |
| `src/i18n/snort.fr.po` | `po/fr/snort.po` |

Uses **legacy LuCI (Lua + CBI)** — depends on `luci-lua-runtime`, not LuCI.js.

## Repairs applied when vendoring

Upstream `install.sh` and several `src/` files had mismatched heredoc terminators and concatenated file contents. This feed ships **reconstructed** view templates and a corrected `config.lua` rules section, verified against the controller API (`get_status`, `action`, `fix_rules`, etc.).

## Refresh from upstream

```sh
scripts/vendor-luci-snort3.sh
# Review diff; fix any corruption again before bumping PKG_RELEASE.
```

## CM5 usage

1. Install **`snort3`** and **`luci-app-snort3`** (snort3 from ImmortalWrt packages feed).
2. Open **Services → Snort IDS/IPS**.
3. Start in **IDS** mode on **`br-lan`** with a minimal rule set; monitor CPU on 2.5 GbE.

See [docs/ids-traffic-analysis-openwrt-research.md](../../../docs/ids-traffic-analysis-openwrt-research.md).
