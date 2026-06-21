---
name: cm5-security-stack
description: >-
  Recommend and configure IDS, DNS filtering, and traffic analysis for Orange Pi
  CM5 Base on ImmortalWrt. Use when working on blocky, luci-app-snort3,
  luci-app-security-guide, banIP integration, or CM5 network/security docs.
---

# CM5 security stack (Orange Pi CM5 Base)

Device: **RK3588S**, dual **2.5 GbE**, ~8 GB RAM. OpenWrt is not a datacenter IDS appliance — use a **layered** stack.

Full research: `docs/ids-traffic-analysis-openwrt-research.md`

## Packages by layer

| Layer | Packages | Feed | CM5 fit |
|-------|----------|------|---------|
| DNS filtering | blocky, luci-app-blocky | **this feed** | Excellent — primary DNS filter |
| | adblock, luci-app-adblock | ImmortalWrt | Excellent — in CM5 profile |
| IP blocklists | banip, luci-app-banip | ImmortalWrt | **Best add-on** — low CPU |
| Signature IDS | snort3, luci-app-snort3 | snort3: ImmortalWrt; LuCI: **this feed** | Good in **passive IDS**; IPS needs tuning |
| Visibility | tcpdump-mini, vnstat2, nlbwmon | ImmortalWrt | Excellent |
| Operator guide | luci-app-security-guide | **this feed** | CM5 profile |
| Heavy IDS/SIEM | Suricata, Zeek, Wazuh | Not in OpenWrt feed | Docker on CM5 or mirror host |

## Recommended tiers

**Tier 1 (default):** blocky + adblock + banip + tcpdump-mini + vnstat2 + nlbwmon

**Tier 2 (optional):** snort3 + luci-app-snort3 in **IDS mode** on `br-lan`, minimal rules, monitor CPU/RAM

**Tier 3 (advanced):** mirror WAN/LAN to Docker for Suricata/Wazuh

## Not recommended on-router

- Suricata **IPS** at 2.5 GbE with large rule sets
- Expecting RK3588 **NPU** to accelerate Snort/Suricata (NPU is ML inference only)

## Install examples (ImmortalWrt 25.12+ / apk)

From **this feed** (after enabling feed):

```sh
apk add blocky luci-app-blocky luci-app-security-guide luci-app-snort3
```

From **standard ImmortalWrt index**:

```sh
apk add banip luci-app-banip snort3 tcpdump-mini vnstat2 luci-app-vnstat2
```

Enable banIP under *Services → banIP*. Run `snort-mgr check` before starting Snort IPS mode.

## Blocky DNS integration (CM5)

| Piece | Role |
|-------|------|
| Blocky | Listens `127.0.0.1:5353` (DNS), `127.0.0.1:4000` (HTTP API) |
| dnsmasq | LAN `:53` → `127.0.0.1#5353` when `blocky.main.dnsmasq_forward=1` |
| `blocky-lists-sync` | UCI blocklists → `/etc/blocky/config.yml` |
| `blocky-lists-refresh` | POST `/api/lists/refresh` (re-download remote lists) |
| LuCI | *Router DNS integration* toggles `blocky-dnsmasq-sync`; Controls tab refreshes lists via API |

Do not run **adblock** alongside Blocky as primary LAN filter (CM5 image disables adblock when Blocky is enabled).

## CM5 network notes

- Default LAN: `br-lan`, ports `eth1`/`eth2`, `192.168.8.1/24` (see immortalwrt `99-opi-cm5-network-migrate`)
- OLED app: `/dev/i2c-1`, status on `br-lan`
- CM5 image includes `docker`/`dockerd` for Tier 3 workloads
