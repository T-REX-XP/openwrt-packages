# Suricata on this feed — plan (CM5 / ImmortalWrt)

**Date:** 2026-08-31  
**Status:** Accepted — P0 docs + P1–P4 recipes in-tree. Engine apk is **not** in GitHub SDK CI; first `make package/suricata/compile` is Docker (`build_immortalwrt`).  
**Goal:** Same *product* as Synology Threat Prevention (Suricata + ET Open + class policy + event UI) on ImmortalWrt, without copying the SPK.

Related:

- [threat-prevention-openwrt-plan.md](threat-prevention-openwrt-plan.md) — earlier mapping (Snort3-first)
- [ids-traffic-analysis-openwrt-research.md](ids-traffic-analysis-openwrt-research.md) — CM5 CPU / NPU / mirror
- Sibling review: `syno-router-review/docs/ThreatPrevention-1.3.3-0926-package-review.md`
- Sibling rules inventory: `syno-router-review/docs/ThreatPrevention-1.3.3-0926-bundled-rules.md`

This document **revises** the engine choice: **Suricata is the target engine** (same tool as SRM). Snort3 stays as a packaged fallback until a `suricata` apk actually builds.

---

## 1. Verdict

Reuse the **approach**, not the SPK.

| Layer | Same as SRM? | How on OpenWrt |
|-------|----------------|----------------|
| Engine | Yes (Suricata, not `synosuricata`) | New feed package `suricata` (8.x), IDS default |
| Rules | Same *feed* (ET Open), not the 2021 tarball | Runtime fetch `rules.emergingthreats.net/open/suricata-8.0/` |
| Class policy | Same *idea* (`signature.conf`) | UCI classtype → alert / disable / (optional) drop |
| Alerts | Same *fields*, not PostgreSQL | Suricata **EVE JSON** → SQLite ring |
| UI | Same *tabs*, not ExtJS | New JS+rpcd `luci-app-threat-prevention` |
| Inline IPS | Same *capability*, not default | `nft queue` later; fail-open documented |

**Do not** vendor `bin/synosuricata`, ET snapshot **9840**, PostgreSQL `synotps`, ExtJS, or `SYNO.TPS.*`.

**Do not** put Suricata in the default CM5 `DEVICE_PACKAGES` until IDS mode is proven (CPU, RAM, overlay log rotation). README lists it as **feed-optional**, like `luci-app-snort3` today.

---

## 2. What we can reuse from the SRM review

### 2.1 Rules

| Source | Reuse? |
|--------|--------|
| SPK `emerging.rules.tar.gz` (ET Open 9840, Suricata **5.0**, dated 2021-09-09) | **No** — stale, Suricata 5 vs 7, provenance from a signed SPK |
| Live ET Open for **Suricata 8** | **Yes** — Proofpoint public tree (`suricata-8.0/`); Suricata 7 is EOL |
| `classification.config` class names | **Yes** — public Snort/ET names (`trojan-activity`, `web-application-attack`, …) |
| `signature.conf` drop/disable classes | **Ideas only** — encode as UCI defaults; default **alert**, not drop |
| `syno-custom-events.rules` (Google Voice pass) | **No** |
| ET Pro / oinkcode | **No** (licensed). Optional UCI later if the operator has a key |
| Review CSV `bundled-alerts.csv` | **Fixtures / classtype list only** — not a runtime threat DB |

ET Open ships every signature as **`alert`**. SRM turns ~11k of them into **drop** at compile time. We keep that split in **policy**, not by rewriting 23k lines in git.

Snort3 community rules are a **different dialect**. If the engine is Suricata, fetch the **Suricata** ET tree, not the SPK tarball and not Snort community as the primary set.

### 2.2 Alert store

| Source | Reuse? |
|--------|--------|
| Runtime PostgreSQL `synotps` rows | **No** — per-box events, payloads, LAN IPs |
| CERT/Barnyard2 table *ideas* (SID, IP/TCP headers, timestamp) | **Yes** as EVE/SQLite columns |
| Synology columns (`mac_src`, `loading_score`, `synodb`) | **No** |
| Suricata `eve.json` | **Yes** — native; this is why Suricata matches SRM better than `alert_fast.txt` |

Storage on CM5: **no PostgreSQL**. Cap like SRM’s 500 MB–2 GB idea, but on overlay: e.g. 32–128 MB SQLite + logrotate on `/var/log/suricata/eve.json`.

### 2.3 Packet path

SRM: iptables **NFQUEUE 557**, Suricata IPS `mode: repeat`, default **fail-open**.

OpenWrt: firewall4 / **nftables**. IDS = AF_PACKET or nfnetlink copy on `br-lan` (and optionally WAN). IPS = `kmod-nft-queue` later. Default **IDS** so a crash is not a silent bypass of “IPS”.

---

## 3. Target architecture

```
br-lan / wan
    │
    ├─ banIP + Blocky          (Tier 1 — already on CM5)
    └─ suricata (Tier 2, feed)
           │  IDS: afpacket on br-lan
           │  IPS: nft queue (P5, not default)
           ▼
     /var/log/suricata/eve.json
           ▼
     tp-eventd  →  /var/lib/threat-prevention/events.sqlite  (ring)
           ▼
     rpcd luci.threat-prevention
           ▼
     LuCI  Services → Threat Prevention
           Status | Events | Policy | Settings
```

Cross-link existing **Services → Snort3** until operators migrate; do not grow legacy `luasrc` Snort UI.

---

## 4. Proposed packages (this feed)

| Path | Package | Role |
|------|---------|------|
| `feeds/packages/suricata` | **suricata** | Engine 8.x (Rust + libhtp, jansson, libpcap, libyaml, libmagic). **New.** |
| `feeds/packages/suricata-etopen` | **suricata-etopen** | Fetch/unpack current ET Open Suricata-7 tree into `/etc/suricata/rules/` |
| `feeds/packages/tp-eventd` | **tp-eventd** | Tail EVE → SQLite ring + `/tmp/tp_status.json` |
| `feeds/luci/luci-app-threat-prevention` | **luci-app-threat-prevention** | Product UI (JS + rpcd + theme CSS) |
| `feeds/packages/snort3` | snort3 | Snort 3 engine (feed-optional; Docker compile) |
| *(keep)* `feeds/luci/luci-app-snort3` | luci-app-snort3 | Raw Snort3 LuCI |

**Not in CM5 image** until P4+ proven. Install:

```sh
apk add suricata suricata-etopen tp-eventd luci-app-threat-prevention
```

Upstream ImmortalWrt still has **no** official `suricata` package (Rust PR history, closed). This feed owns the recipe.

---

## 5. Packaging risks (why this is a plan, not a Makefile today)

1. **Rust** — Suricata ≥5 requires rustc/cargo. ImmortalWrt 25.12 *can* build Rust packages in a full tree; the **GitHub SDK** used by this feed’s CI may not. First compile must happen in `build_immortalwrt` Docker (`linux/arm64`), not assume Pages CI.
2. **CI** — If SDK cannot build Suricata, mark the package `skip` in `.github/workflows` or build it only on the macOS Docker image job. Do not fail `blocky` / LuCI CI on Suricata.
3. **Size / RAM** — Full ET Open is tens of MB on disk and hundreds of MB RSS. Default rule set = **small profile** (malware + c2 + web_server); full ET is opt-in in Settings with a RAM warning.
4. **2.5 GbE IPS** — Still **not recommended** inline with large rules ([IDS research](ids-traffic-analysis-openwrt-research.md)). IDS on `br-lan` is the ship target.
5. **NPU** — RK3588 NPU does not accelerate Suricata.

Fallback if `suricata` does not compile in a reasonable time: keep **Snort3** as the engine, still use EVE-like JSON if available, still fetch **Snort-flavoured ET**, still the same LuCI. Product UI is engine-agnostic behind rpcd.

---

## 6. Phases

### P0 — Docs / README (after this plan is accepted)

- README packages table: planned `suricata` (feed, not CM5 image).
- README IDS section: Suricata **IDS optional**; IPS not in image; link this file.
- `cm5-security-stack` skill: Suricata feed-optional IDS; still no default-image IPS.
- Amend [threat-prevention-openwrt-plan.md](threat-prevention-openwrt-plan.md) engine table: Suricata target, Snort3 fallback.

### P1 — Engine compile

- `feeds/packages/suricata/Makefile` for ImmortalWrt 25.12 / `aarch64_generic`.
- Prove `make package/suricata/compile` in Docker builder.
- Init: procd, UCI `suricata.@suricata[0]`, yaml generated from UCI (do not ship SRM `suricata.yaml.template`).
- Default: IDS, `br-lan`, EVE to `/var/log/suricata/eve.json`.

### P2 — Rules updater

- `suricata-etopen`: wget + extract; record version/mtime in `/tmp/tp_status.json`.
- `suricata-update` if we can vendor it as a small Python/host script — optional; wget of the official tarball is enough for v1.
- After fetch: `suricata -T` then `reload`.

### P3 — Events

- Enable EVE `alert` (and optionally `stats`).
- `tp-eventd`: last N events for rpcd (SID, msg, classtype, src/dst, proto, timestamp).
- Rotation + max bytes on overlay.
- Tests: fixture EVE lines → stable JSON.

### P4 — LuCI

- **Services → Threat Prevention**: Status, Events, Policy (class defaults), Settings (URL, schedule, IDS/IPS, fail-open).
- Bootstrap CSS variables; `rpc.declare` + `expect`.
- Cross-links: Blocky, banIP, Snort3.

### P5 — Class policy

- UCI map classtype → alert / disable / drop.
- Generate include rules or `rule-files` list — do not rewrite the ET tree in place.
- Defaults inspired by SRM high-risk classes, **alert not drop**.

### P6 — Optional IPS

- `kmod-nft-queue`, fail-open UCI, iperf3 on CM5 2.5 GbE before any profile enable.

---

## 7. README text (proposed, not applied)

Packages table row:

```text
| `feeds/packages/suricata` | **suricata** — Suricata 8 IDS (optional; not in CM5 image) |
| `feeds/luci/luci-app-threat-prevention` | Threat Prevention LuCI (EVE events, ET Open, class policy) |
```

IDS section: replace “Heavy IDS / SIEM = not in feed / external Docker only” with:

- On-router **Suricata IDS** (this feed, optional apk) for SRM-like signatures + EVE events.
- **Not** in the default CM5 image; **not** inline IPS at 2.5 GbE with full ET Open.
- Rules: live ET Open (Suricata 8), not Synology’s bundled 9840 snapshot.
- External mirror host remains the path for full SIEM / Zeek / Wazuh.

---

## 8. Will not do

1. Copy SPK ELF, ExtJS, WebAPI, AppArmor, UDC, or ET 9840 into git.
2. PostgreSQL on the router.
3. ET Pro / oinkcodes in the image.
4. Default-image Suricata or default **drop** policy.
5. Treat `syno-router-review` unpacked trees as a package source.

---

## 9. Decision needed

1. **Accept Suricata-first** (this doc) vs keep Snort3-only until a binary exists.
2. **Allow README P0 now** (document as planned) vs wait until P1 compiles.
3. **CI:** skip Suricata on GitHub SDK, compile only in Docker builder?

Recommended: **1 = Suricata-first**, **2 = README after P0 wording approved**, **3 = skip SDK CI for suricata**.
