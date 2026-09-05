---
name: suricata-ids-cm5
description: >-
  Suricata IDS host stack on CM5 ImmortalWrt: luci-app-threat-prevention
  (user-facing Suricata), tp-eventd, suricata-etopen, rules/policies, ucode
  rpcd. Use when editing those packages, ET Open feeds, SID tunings, classtype
  policies, or deploying Suricata LuCI to 192.168.8.1.
---

# Suricata IDS on CM5 (host)

LuCI menu **Services → Suricata**. Package id stays **`luci-app-threat-prevention`** (rpcd `luci.threat-prevention`, CSS `.luci-app-threat-prevention`). Do not rename the package. Do not restore the title **Threat Prevention**.

Engine packages: `suricata`, `suricata-etopen`, `tp-eventd`. In the CM5 image, **disabled by default**. Passive IDS on `br-lan`. Do not recommend inline IPS at 2.5 GbE.

Tiers and banIP/Blocky: skill **`cm5-security-stack`**.

## Paths

| Piece | Path |
|-------|------|
| LuCI view | `feeds/luci/luci-app-threat-prevention/htdocs/.../view/services/threat-prevention.js` |
| rpcd | `feeds/luci/luci-app-threat-prevention/root/usr/share/rpcd/ucode/luci.threat-prevention.uc` |
| Menu | `.../menu.d/luci-app-threat-prevention.json` (`title`: `Suricata`) |
| Index | `feeds/packages/tp-eventd/files/usr/sbin/tp-rules-index` |
| SID suppress | `.../tp-rules-apply` → `/etc/suricata/threshold.config` |
| Ruleset policy | `.../tp-policy-apply` → `/var/run/suricata/policy.meta` |
| YAML apply | `feeds/packages/suricata/files/usr/sbin/suricata-config-apply` |

## UCI (`suricata`)

| Section | Role |
|---------|------|
| `main` | enabled, mode (`ids`/`ips`), interface, home_net, rule_profile (`small`/`full`) |
| `etopen` | rule feed URL(s) |
| `ruleset` `rs_*` | per-file enable + action |
| `classtype` | default action per classtype |
| `sid` `s${sid}` | per-SID status/action/threshold (survives ET fetch) |

Vendor `.rules` stay read-only. Tunings live in UCI. Per-SID action wins; file action wins over classtype if no SID override. Drop/reject only block in Prevention mode; IDS logs them as alerts.

## Apply pipeline

`suricata-config-apply` → `tp-rules-apply` + `tp-policy-apply`. If any non-alert action, copies land in `/var/run/suricata/rules`; YAML `default-rule-path` / `rule-files` come from `policy.meta`. Fetch runs apply after download.

## LuCI UX (frozen)

- One Save & Apply: LuCI footer only. Policy tab has no extra Save; footer writes settings and policies together.
- **Reset rulesets to profile** stays on the Policy tab (clears custom `rs_*` UCI).
- No Blocky/Snort header cross-links.
- No CM5 / 2.5 GbE copy in views.
- Rules: tick rows → Enable / Disable / Review / Expire / Set action / Reindex. Status badge opens the SID editor.
- `rpc.declare` always `expect: { '': {} }`. All `E('button'` need `'type': 'button'`.

## ucode (`'use strict'`)

Functions are **not hoisted**. Define helpers **above** the first caller (`list_etopen_feeds` before `get_config`, `distinct_col` before `get_policies`, `parse_enabled_flag` before `replace_policies`). Tests in `tests/tp-core.test.mjs` assert that order.

Do **not** put `{` `}` in ucode regex or string patterns (interpolation). URL placeholders: `chr(123)` / `chr(125)`.

## Deploy to live router

```sh
scp -i ~/.ssh/id_ed25519_openwrt_mcp FILE.uc root@192.168.8.1:/tmp/luci.threat-prevention.uc
ssh -i ~/.ssh/id_ed25519_openwrt_mcp root@192.168.8.1 'ucode /tmp/luci.threat-prevention.uc'
# exit 0, then:
#   cp → /usr/share/rpcd/ucode/luci.threat-prevention.uc
#   JS → /www/luci-static/resources/view/services/threat-prevention.js
#   menu → /usr/share/luci/menu.d/
/etc/init.d/rpcd restart
ubus call luci.threat-prevention getConfig
ubus call luci.threat-prevention getPolicies
```

Hard-refresh LuCI after JS/menu changes. Bump `PKG_RELEASE` on recipe changes.

## Tests

```sh
feeds/luci/luci-app-threat-prevention/tests/run-tests.sh
feeds/packages/tp-eventd/tests/run-tests.sh
```

## Do not

- Rename package / rpcd / CSS class to `luci-app-suricata`
- Restore **Threat Prevention** as the menu or H2
- `uci delete` the SID section on re-enable (wipes tunings)
- Restore `evt input` / MCU display logic (wrong skill)
