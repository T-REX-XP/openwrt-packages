# luci-app-snort3 — upstream notes

Originally vendored from [dddavid51/luci-snort3-openwrt](https://github.com/dddavid51/luci-snort3-openwrt) (GPL-2.0-or-later, tag v3.6).

**ImmortalWrt 25.x does not ship `luci.cbi`.** This package is a JS view + `rpcd` ucode backend (`luci.snort3`), not Lua CBI.

| Path | Role |
|------|------|
| `htdocs/.../view/services/snort.js` | Services → Snort IDS/IPS |
| `root/usr/share/rpcd/ucode/luci.snort3.uc` | Status, config, alerts, rules |
| `root/usr/share/rpcd/acl.d/luci-app-snort3.json` | ACL |
| `root/usr/share/luci/menu.d/luci-app-snort3.json` | Menu |

Do not restore `luasrc/` from upstream; that controller calls `cbi("snort/config")` and crashes LuCI with `module 'luci.cbi' not found`.

## CM5 usage

1. Image includes **`snort3`** + **`luci-app-snort3`** (disabled by default).
2. Open **Services → Snort IDS/IPS**.
3. Start in **IDS** mode on **`br-lan`**; monitor CPU on 2.5 GbE.

See [docs/ids-traffic-analysis-openwrt-research.md](../../../docs/ids-traffic-analysis-openwrt-research.md).
