# Threat Prevention on ImmortalWrt — mapping plan

**Date:** 2026-08-31  
**Source review:** sibling checkout `syno-router-review/docs/ThreatPrevention-1.3.3-0926-package-review.md` (not in this git repo).  
**Target:** this feed (`openwrt-packages`) on **Orange Pi CM5 Base** (ImmortalWrt 25.12, `rockchip/armv8`, ~8 GB RAM, dual 2.5 GbE).  
**Existing stack:** [ids-traffic-analysis-openwrt-research.md](ids-traffic-analysis-openwrt-research.md), `luci-app-snort3`, `blocky`, `luci-app-security-guide`.

This document answers: *can we lift Threat Prevention (rules DB, alerts, UI, IPS) into this feed, and how?*

---

## 1. Verdict

A **Threat Prevention–like product** on OpenWrt is feasible as a **layered feed feature**, not as a port of the SPK.

| Synology piece | Copy into this repo? | OpenWrt equivalent |
|----------------|----------------------|--------------------|
| `synosuricata` 6.0.4 + `libsynotps` | **No** (proprietary, stripped, CVE-stale) | This feed **`suricata`** 8.x (IDS); ImmortalWrt **`snort3`** fallback |
| ExtJS UI + `SYNO.TPS.*` WebAPI | **No** (proprietary) | New **JS + rpcd** LuCI app |
| PostgreSQL `synotps` + `synodb` | **No** (too heavy; custom output) | **EVE JSON** / `alert_fast` + optional SQLite ring |
| Bundled `emerging.rules.tar.gz` (ET Open **9840**, Suricata 5.0) | **Do not vendor from the SPK** | Fetch **live ET Open** (or Snort community) at runtime |
| ET Pro (`emergingthreatspro.com` + oinkcode) | **No** (licensed; Cypress-only in that SPK) | Optional operator oinkcode later; not in image |
| `syno-custom-events.rules` (Google Voice pass) | **No** (Synology policy; stale IP) | Our own UCI exceptions if needed |
| `classification.config` | **Ideas only** | Public Snort/ET classification (same names) |
| Barnyard2/ACID-style SQL schema | **GPL-2 CERT schema is public**; do not copy Synology extensions blindly | SQLite subset *or* skip SQL and parse EVE |
| AppArmor, upstart, UDC collector, NFQUEUE 557 | **No** | procd, firewall4/`nft queue`, no telemetry |

**Recommendation:** do **not** put full inline IPS + 23k ET rules in the default CM5 image. Ship a **Tier 2 optional** package: LuCI “Threat Prevention” over **Suricata IDS** (passive AF_PACKET) + class policy + live ET Open + EVE/SQLite events. **Snort3** stays until the Suricata apk is proven in Docker. Keep **banIP** + **Blocky** as Tier 1. Mirror to an external host remains Tier 3.

Engine table: **Suricata is the target**; Snort3 is the packaged fallback. Details: [suricata-openwrt-plan.md](suricata-openwrt-plan.md).

---

## 2. What Threat Prevention actually is (product features)

From the SPK review, the user-visible product is:

1. **Inline IPS** — Suricata in NFQUEUE (`-q 557`), `mode: repeat`, fail-open by default (`availability`).
2. **Signature feed** — Emerging Threats Open (and ET Pro on Cypress), class defaults (trojan/admin/shellcode → drop), operator overrides, per-device skip.
3. **Alert store** — PostgreSQL events with IP/TCP/UDP/ICMP headers, payload, MAC, GeoIP/maps, hourly rotation (500 MB–2 GB cap).
4. **Admin UI** — Overview, Events, Self-Defined Policy, Statistics, Settings (update schedule, storage, backup `.dss`).
5. **Ops** — auto rule wget, sensor restart on WAN/topology change, syslog isolation.

Helpful properties to **imitate** (not copy):

- Class-based default actions (`signature.conf`).
- Fail-open vs fail-closed as an explicit UCI choice.
- Event list with SID, class, src/dst, time — not a raw `tail` of a log file.
- Rule update as a first-class Settings action.
- Do **not** imitate: PostgreSQL on the router, Google Maps, UDC telemetry, rewriting `kernel.core_pattern`, Python 2, empty `status` in init.

---

## 3. Can we grab the rules DB and alerts from the SPK?

### 3.1 Rules (`emerging.rules.tar.gz`, version 9840)

| Question | Answer |
|----------|--------|
| What is in the SPK? | ET Open snapshot, Suricata **5.0** tree, ~59 files, ~68k rule lines, **23,028 `alert`**, **0 `drop`** in the tarball. Drops are applied later by Synology policy compile. |
| ET Open license? | Proofpoint **Emerging Threats Open** is redistributable under their open-rules terms (typically BSD-style). The **content** is public. |
| May we copy the file out of the SPK into `openwrt-packages`? | **Do not.** The tarball is a **vendor-packaged snapshot** inside a signed Synology payload. Mixing it into this git repo creates provenance, freshness (9840 is not current), and “derived from SPK” confusion. Engine in the SPK is Suricata 6 vs rules labelled 5.0. |
| How should OpenWrt get ET Open? | **Download at runtime** (or image-build with an explicit `PKG_SOURCE` from Proofpoint), e.g. `https://rules.emergingthreats.net/open/suricata-8.0/` or the Snort-compatible tree that matches **snort3**. Prefer **current** folders, not `suricata-5.0`. |
| ET Pro? | Requires a paid **oinkcode**. Cypress-only in that SPK. **Do not** ship Pro rules. Optional UCI field later if the operator has a license. |
| Snort3 vs Suricata rules? | Not drop-in. ET publishes **separate** trees. This feed already depends on **`snort3`** from ImmortalWrt. Use **Snort 3 community** and/or **ET Open for Snort 3**, not the Suricata tarball from the SPK. |
| `classification.config` | Standard Snort/ET class names (`trojan-activity`, `web-application-attack`, …). Re-create from **public** Snort/ET classification files, not from Synology packaging. |
| `syno-custom-events.rules` | Synology-specific `pass` to `74.125.39.90` (Google Voice STUN). **Do not copy.** Hardcoded anycast IPs go stale (review finding M5). |

**Practical rule pipeline for this feed:**

```
wget ET Open / snort3-community  →  /etc/snort/rules/  →  class policy (UCI)
     →  snort-mgr / snort3 reload  →  alerts to /var/log/snort/  (eve.json or alert_fast)
```

Do **not** compile 23k rules as `drop` on 2.5 GbE. Default: **alert-only** (IDS). Optional IPS only for a **tiny** high-severity class set after iperf3.

### 3.2 Alerts (PostgreSQL `synotps`)

| Question | Answer |
|----------|--------|
| What is “the alerts DB”? | Runtime **events**, not a static file in the SPK. Schema is in `schema/syno_create_postgresql` (CERT/Barnyard2 GPL-2 core + Synology `device`, `policy_*`, `loading`). |
| Can we copy the schema and empty DB? | The **CERT Barnyard2 tables** (`event`, `iphdr`, `tcphdr`, …) are **GPL-2**. Synology columns (`mac_src`, `loading_score`, `synodb`) are their product. Copying the Synology DDL as a product clone is unnecessary. |
| Can we copy historical alerts from a running SRM box? | Only if **you** exported them (CSV/USB wizard). Those rows may include **packet payloads** and LAN IPs — treat as sensitive. They are **not** a reusable “threat intelligence DB” for OpenWrt. |
| OpenWrt storage | **No PostgreSQL** on the CM5 image. Use **EVE JSON** (newline JSON, same idea as Suricata `eve.json`) or Snort `alert_fast.txt`. Optional **SQLite** ring buffer (size-capped, like their 500 MB rotation) under `/var/lib/threat-prevention/` on overlay. |

**Bottom line:** grab **fresh public rules from ET/Snort**, not the SPK tarball. Grab **alert format ideas**, not Synology event rows or `synodb`.

---

## 4. Feature mapping (SPK → this feed)

```
WAN / br-lan
     │
     ├─ nftables + banIP          (Tier 1 — IP feeds; already recommended)
     ├─ dnsmasq → Blocky :5353    (Tier 1 — DNS; already in CM5 image)
     └─ snort3  (Tier 2 optional)
            │  IDS: afpacket/pcap on br-lan
            │  IPS: nft queue (experimental, not default)
            ▼
     /var/log/snort/eve.json  (or alert_fast)
            ▼
     tp-eventd (new, small)  →  SQLite or JSONL ring
            ▼
     rpcd luci.threat-prevention  →  LuCI JS (Overview / Events / Policy / Settings)
```

| Threat Prevention UI | OpenWrt plan |
|----------------------|--------------|
| Overview (sensor on/off, counts) | `luci-app-threat-prevention` status: snort3 running, last alert time, rule version, CPU hint |
| Events | Paginated parse of EVE/SQLite (SID, msg, class, src/dst, proto, time) — replace `luci-app-snort3` `tail -10 alert_fast.txt` |
| Self-Defined Policy | UCI: per-class `alert` / `drop` / `disable`; optional SID overrides; **no** Google Voice pass |
| Statistics / maps | **Skip Google Maps.** Optional: counts by class/SID; GeoIP only if a small geoip package is already present |
| Settings → signature update | `hotplug`/`cron` wget + `snort-mgr` / service reload |
| Settings → storage | logrotate + max events / max bytes (overlay-aware) |
| Backup `.dss` | UCI export (`sysupgrade -b` / `luci backup`); do not invent a binary blob |
| Device skip-list | Optional later: MAC/IP nft skip set (banIP already covers IPs) |

---

## 5. Proposed packages (this feed)

Do **not** add Suricata or Snort3 to `DEVICE_PACKAGES`. This feed now vendors **`snort3`** (openwrt/packages + CM5 UCI); when the feed is linked it shadows ImmortalWrt’s `snort3`.

| Path | Package | Role |
|------|---------|------|
| `feeds/packages/snort3` | `snort3` (+ ImmortalWrt `libdaq3`, optional `kmod-nft-queue`) | Engine (Docker compile; skip SDK CI) |
| *(upstream)* | `banip` + `luci-app-banip` | IP threat feeds |
| `feeds/packages/snort-etopen` *(new, optional)* | Fetcher/unpacker for **current** ET Open **or** snort3-community into `/etc/snort/rules/` | Rules — **PKG_SOURCE from Proofpoint/Cisco, not SPK** |
| `feeds/packages/tp-eventd` *(new, optional)* | Tiny daemon: tail EVE → SQLite ring + `/tmp/tp_status.json` | Alert store |
| `feeds/luci/luci-app-threat-prevention` *(new)* | JS + `rpcd/ucode` + `*-theme.css` | Product UI |
| `feeds/luci/luci-app-snort3` *(existing)* | Keep for raw Snort UCI; **cross-link** from the new app; do not grow legacy `luasrc` | Engine config |

**CM5 image:** leave Threat Prevention **out** of `DEVICE_PACKAGES` until IDS mode is proven (CPU/RAM, log rotation). Document `apk add` like `luci-app-snort3` today.

**Naming:** “Threat Prevention” in LuCI is fine as a **user-facing title**. Package ids should stay `luci-app-threat-prevention` so we are not impersonating Synology’s `SYNO.SDS.TPS`.

---

## 6. Implementation phases

### P0 — Policy (no code)

- [x] This document.
- [ ] Confirm Snort3 vs Suricata: **Snort3** (packaged). Suricata stays Tier 3 external.
- [ ] Confirm default **IDS / alert-only**.
- [ ] Do not commit SPK blobs, ELF, ExtJS, or `emerging.rules.tar.gz` from `syno-router-review/`.

### P1 — Alert path (P0 of the product)

- Point Snort3 at **EVE JSON** (or keep `alert_fast` and parse it).
- `tp-eventd` or a `hotplug`/logread helper: last N events as JSON for rpcd.
- Rotation: `logrotate` + max file size on `/overlay`.
- Tests: fixture EVE lines → stable JSON (100% on new Go/ucode helpers if we add a small Go parser).

### P2 — LuCI (JS + rpcd)

- Menu: **Services → Threat Prevention** (or Security).
- Tabs: Status, Events, Policy (class defaults mirroring `signature.conf` *ideas*), Settings (rules URL, schedule, mode IDS/IPS).
- Bootstrap theme CSS variables only (feed LuCI rule).
- Cross-links: Blocky, banIP, existing Snort3 page.

### P3 — Rules updater

- UCI: `rules_url`, `rules_enabled`, cron/interval.
- Fetch **snort3-community** first (small). ET Open as opt-in (large; warn RAM).
- After fetch: `snort-mgr check` then reload.
- Record `rules_version` / fetch time in `/tmp/tp_status.json` for the UI.

### P4 — Class policy

- Map classtype → `alert` / `disable` (and `drop` only if IPS mode).
- Generate a small `local.rules` / `snort.lua` include — do not rewrite 23k lines in place.
- Defaults inspired by Synology high-risk classes, but **alert not drop** until the operator enables IPS.

### P5 — Optional IPS

- `kmod-nft-queue`, `snort` IPS mode, **fail-open documented** (H3 in the SPK review).
- Throughput test on CM5 2.5 GbE before any profile enable.
- Default remains **IDS**.

### P6 — Docs / README / security-guide

- Link this file from [README.md](../README.md) IDS section.
- Add a short page in `luci-app-security-guide` pointing at the new app.
- Update `cm5-security-stack` skill when packages exist.

---

## 7. What we will not do

1. Vendor `synosuricata`, `synotpsd`, WebAPI `.so`, ExtJS, AppArmor, or UDC.
2. Run PostgreSQL on the CM5 for IDS events.
3. Enable ET Pro or ship oinkcodes.
4. Copy `syno-custom-events.rules` or treat SPK ET 9840 as a live feed.
5. Inline Suricata IPS at 2.5 GbE in the default image ([existing IDS research](ids-traffic-analysis-openwrt-research.md)).
6. Expect RK3588 NPU to accelerate Snort.

---

## 8. Risks (from the SPK review, applied here)

| SPK finding | OpenWrt mitigation |
|-------------|-------------------|
| H1 stale engine + 5.0 rules | Use distro **snort3** + **current** community/ET tree |
| H3 fail-open default | UCI `fail_open`; default IDS so a crash does not “bypass IPS” |
| M1 over-privileged API | LuCI ACL: admin session only; no demo-mode grant-all |
| M2 SQL concatenation | Avoid SQL in shell; parameterized SQLite or no SQL |
| M3 core_pattern / swap | Do not touch |
| M6 telemetry | Do not add |
| L1 empty status | procd + pid in getStatus RPC |

---

## 9. Operator notes (when P2 exists)

1. Install from this feed: `apk add snort3 luci-app-threat-prevention` (plus `snort-etopen` if split).
2. Start in **IDS** on `br-lan`; confirm `snort-mgr check`.
3. Enable a **small** rule set first; watch RAM and `/overlay`.
4. Use **banIP** + **Blocky** for the majority of “known bad” blocking.
5. For Suricata-class IPS, mirror to another host — do not expect SPK-parity inline performance.

---

## 10. References

- Threat Prevention 1.3.3-0926 package review — sibling tree `syno-router-review/docs/ThreatPrevention-1.3.3-0926-package-review.md`
- [IDS / traffic analysis on CM5](ids-traffic-analysis-openwrt-research.md)
- [ET Open (Proofpoint)](https://rules.emergingthreats.net/)
- [openwrt/packages snort3](https://github.com/openwrt/packages/blob/master/net/snort3/Makefile)
- [luci-app-snort3 in this feed](../feeds/luci/luci-app-snort3/)
- CERT Barnyard2 schema header: GPL-2 (Carnegie Mellon) in `syno-router-review/unpacked/package/schema/syno_create_postgresql`
