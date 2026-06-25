# IDS / Traffic Analysis on OpenWrt / ImmortalWrt — Research Report

*Last updated: 2026-06-25.*

## Summary

For **Orange Pi CM5 Base** (RK3588S, aarch64, dual **2.5 GbE**, ~8 GB RAM class hardware), a **layered** security model fits OpenWrt better than “full Suricata on the router” alone:

| Goal | Best fit on CM5 |
|------|------------------|
| Block known bad IPs / feeds | **`banIP`** + **`luci-app-banip`** |
| DNS / domain threat filtering | **`adblock`**, **`luci-app-adblock`** (in CM5 image); **`blocky`** optional via feed |
| Deep packet / signature IDS (Snort/Suricata class) | **`snort3`** on-router **or** **mirror to a separate host** |
| Full **Suricata** in official feeds | **Not available** (Rust / maintenance; see below) |
| Traffic visibility (not IDS) | **`tcpdump-mini`**, **`vnstat2`**, **`nlbwmon`**, **`luci-app-statistics`** |
| **NPU acceleration** for packet inspection | **No practical path today** — NPU is for ML inference, not L7 IDS |

**Recommended default for this project:** add **`banIP`** + **`luci-app-banip`**, keep **`adblock`**; optionally install **`blocky`** from the feed; optionally **`snort3`** in **IDS (passive)** mode with a **minimal rule set**; use an **external** Docker host for heavy Suricata/SIEM if needed.

---

## Hardware context — Orange Pi CM5 Base

From **`immortal_opi_cm5`** / **`armv8.mk`** profile:

- **SoC:** Rockchip **RK3588S** — 4× Cortex-A76 + 4× Cortex-A55
- **Network:** **`kmod-r8125`** (2.5 GbE); routing/NAT/SQM load scales with line rate
- **RAM:** Typically sufficient for **Snort3 IDS** or **banIP**, but **not** for “datacenter rule sets at wire speed”
- **Image today:** **`adblock`**, **`luci-app-adblock`**, **`nlbwmon`**, **`luci-app-nlbwmon`**; **`banIP`**, **`tcpdump-mini`**, **`vnstat2`** as profile targets — verify **`DEVICE_PACKAGES`** when enabling. **`blocky`**, **`luci-app-blocky`**, **`docker`**, **`luci-app-security-guide`**, **`luci-app-statistics`**, **`sqm-scripts`** are **not** in the slim CM5 profile (install from feed if needed).

**Implication:** CM5 is **strong for an OpenWrt router**, but **2.5 GbE + full IPS rule sets** will still CPU-bound before the NPU helps in any way.

---

## Suricata

### Status in OpenWrt

- **Not in** the official **`openwrt/packages`** feed as a maintained package.
- [PR #8659](https://github.com/openwrt/packages/pull/8659) to add Suricata was **closed**: Rust is **mandatory** since Suricata 5.x, OpenWrt Rust packaging was immature, and maintainers cited **resource cost vs. benefit** on typical routers.
- Community builds exist (thesis / blog posts on cross-compiling for **aarch64**), but you own **updates, rules, and RAM/CPU tuning**.

### When Suricata still makes sense

- **Separate analysis host** (PC, VM, or **Docker on CM5**): router **mirrors** traffic (e.g. **`iptables`/`nftables` `TEE`** to another interface/IP) — pattern described in [Wazuh + Suricata + OpenWrt](https://blog.sienicki.eu/en/wazuh-suricata-ids-openwrt/).
- **High-end ARM router**, **≤1 GbE**, **curated rules** — some users report acceptable CPU on devices like NanoPi R4S at ~100 Mbit–1 Gbit ([forum reports](https://linux-nerds.org/topic/992/openwrt-mit-suricata)); throughput drops sharply with **many rule sources** (e.g. 14 MB/s → 5 MB/s cited with four rule feeds).

### Verdict for CM5

| Mode | Feasibility |
|------|-------------|
| Suricata **IPS inline** on **2.5 GbE** | **Poor** — expect major throughput hit |
| Suricata **IDS** passive, light rules | **Possible** — monitor CPU and RAM |
| Suricata on **Docker/second box**, router mirrors | **Best** for serious signature IDS |

---

## Snort3 (strongest “real IDS” option in OpenWrt feeds)

### Packaging

- **`snort3`** is in **[openwrt/packages `net/snort3`](https://github.com/openwrt/packages/blob/master/net/snort3/Makefile)** (current feed versions ~3.12.x).
- **Dependencies:** `libdaq3`, `libpcap`, `luajit`, **`kmod-nft-queue`** (for IPS), `ucode`, optional **`vectorscan`** (Hyperscan fork) on **x86_64** and **aarch64** for faster pattern matching.
- **Init:** `snort.init` uses **procd**, **`snort-mgr`** for config validation/setup ([upstream init](https://github.com/openwrt/packages/blob/master/net/snort3/files/snort.init)).
- **LuCI:** no official **`luci-app-snort3`** in main LuCI; community **[luci-snort3-openwrt](https://github.com/dddavid51/luci-snort3-openwrt)** (2025) provides **Services → Snort IDS/IPS** UI.

### Modes

- **IDS:** listen on **`br-lan`** / **`lan`** — log alerts, no inline break.
- **IPS:** uses **nftables queue** — can **drop/modify** traffic; higher risk of breakage and latency.

### CM5 fit

- **Better packaged path than Suricata** for ImmortalWrt (feed package, no Rust stack).
- Start with **IDS + tuned rules**; treat **IPS** as experimental on **2.5G**.
- **vectorscan** on aarch64 helps rule matching but does **not** offload the whole datapath.

---

## Lightweight / complementary options (OpenWrt-native)

### banIP — closest to “IPS-like blocking” without deep inspection

- **[banIP README](https://github.com/openwrt/packages/blob/master/net/banip/files/README.md)** — **`nftables` sets**, many **threat feeds** (Emerging Threats, Threatview, CINSscore, etc.), **`luci-app-banip`** under **Services → banIP**.
- Blocks **IPs/subnets** (and related lists), **not** full L7 payload analysis.
- **Low overhead**, good fit for **router self-protection** and **outbound/inbound blocklists**.
- **Recommended** for CM5 default image if the goal is “block known bad actors” without Snort complexity.

### DNS-layer (already on CM5 profile)

- **`adblock`**, **`blocky`** — domain lists, malware/phishing **DNS** blocking; complements banIP (IP) vs hostname (DNS).

### Visibility / “analyze traffic” (not IDS)

| Tool | Role |
|------|------|
| **`tcpdump-mini`** / **`tcpdump`** | Packet capture / debug |
| **`vnstat2`** / **`luci-app-vnstat2`** | Per-interface volume over time |
| **`nlbwmon`** / **`luci-app-nlbwmon`** | Per-host traffic accounting |
| **`luci-app-statistics`** (collectd) | Graphs, optional plugins |
| **`luci-app-sqm`** | Bufferbloat / QoS (not security) |

### Other ecosystems (not in default ImmortalWrt tree; extra feeds/work)

- **CrowdSec** — collaborative IP reputation + bouncers; heavier; check third-party feeds.
- **Zeek** — network analysis / logs; **too heavy** for typical router role; server/VM.
- **nDPI** / **ntopng** / **netifyd** — **protocol/application identification** and flows; useful for **traffic analysis**, usually **not** a turnkey IDS on OpenWrt without dedicated packaging and RAM.

---

## Architecture patterns

```
┌─────────────────────────────────────────────────────────────┐
│  CM5 router (ImmortalWrt)                                    │
│  • banIP + adblock/blocky  → block known bad IP/DNS         │
│  • snort3 (optional) IDS on br-lan → alerts to log/syslog   │
│  • nftables firewall + fwknopd / Tailscale (already profile)│
└──────────────────────────┬──────────────────────────────────┘
                           │ optional mirror (TEE / SPAN)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Analysis host (Docker on CM5 or separate PC)                │
│  • Suricata / Zeek / Wazuh — full rules, long-term logs      │
└─────────────────────────────────────────────────────────────┘
```

**GL.iNet / community consensus:** many admins prefer **IDS on a dedicated system**, router for **blocking lists + mirror** ([GL.iNet forum](https://forum.gl-inet.com/t/ids-ips-intrusion-detection-prevention/43274)).

---

## SoC NPU (RK3588 “6 TOPS”) — can it accelerate IDS?

### Short answer: **No for Suricata/Snort packet paths**

The RK3588 **NPU (RKNN / RKNPU)** is a **neural processing unit** for **ML model inference** (INT8/FP16), **not** a generic packet processor. [OpenWrt forum discussion](https://forum.openwrt.org/t/how-to-use-rockchip-6tops-npu-to-accelerate-the-processing-of-network-packets/208582) states clearly: **NPU ≠ network packet acceleration**; routing/NAT at gigabit is normally **CPU software** on these SoCs.

| Use case | NPU useful? |
|----------|-------------|
| Snort/Suricata signature matching | **No** |
| nftables / banIP | **No** |
| **ML anomaly detection** on **flows or logs** (post-processing) | **Theoretically yes**, custom project |
| Video AI gateway (vendor demos) | **Yes** — different product ([Forlinx RK3588 AI gateway](https://www.forlinx.net/industrial-news/rk3588-ai-security-gateway-705.mhtml)) |

### Kernel / software stack on OpenWrt-class kernels

- **Legacy `CONFIG_ROCKCHIP_RKNPU`:** common in **Rockchip downstream** kernels; **not** in typical **mainline-first** OpenWrt/ImmortalWrt **`config-6.12`** today.
- **Mainline direction:** **`accel/rocket`** driver for RK3588 NPU ([kernel docs](https://docs.kernel.org/accel/rocket/index.html), [patch series 2025](https://lists.infradead.org/pipermail/linux-arm-kernel/2025-July/1044684.html)) + **Mesa rocket** userspace — **early**, not an OpenWrt default.
- **Userspace:** **RKNN-Toolkit2** / **`librknnrt`** — proprietary Rockchip stack; models must be converted to **RKNN** format ([Edge AI on RK3588](https://tristanpenman.com/blog/posts/2025/07/20/edge-ai-using-the-rockchip-npu/)).

### Realistic “AI + IDS” hybrid (research only)

Academic work combines **Suricata (signatures)** with **ML on alerts/logs** for fewer false positives ([Karazin study](https://periodicals.karazin.ua/mia/article/view/28374)) — ML runs **after** Suricata, not inside the NPU-accelerated datapath. A **custom** pipeline on CM5 could:

1. Run **Snort3/Suricata** on **CPU** (or mirror to Docker).
2. Export **eve.json** / syslog.
3. Run a **small RKNN model** on NPU for **scoring** (requires **downstream NPU driver + RKNN** or future **rocket** stack).

That is a **multi-month firmware project**, not an **`opkg install`**.

### DPDK note

**[openwrt-dpdk](https://github.com/k13132/openwrt-dpdk)** targets **x86_64/aarch64** user-space polling; Snort3/Suricata can use DAQ/DPDK in **custom** builds, but **not** standard OpenWrt **`snort3`** package, and setup on a **router** is **non-trivial** (IOMMU/VFIO, dedicated cores). **Not recommended** for CM5 router-first design.

---

## Comparison table

| Solution | Type | OpenWrt package | LuCI | CM5 on-router | NPU help |
|----------|------|-----------------|------|---------------|----------|
| **banIP** | IP blocklists / “mini-IPS” | Yes | **luci-app-banip** | **Excellent** | No |
| **adblock / blocky** | DNS filtering | Yes | Yes | **adblock in profile**; blocky via feed | No |
| **Snort3** | Signature IDS/IPS | Yes | Community LuCI | **Good (IDS)**; IPS caution | No |
| **Suricata** | Signature IDS/IPS | **No** (official) | External | Build yourself / Docker | No |
| **tcpdump / vnstat / nlbwmon** | Capture / stats | Yes | Partial | **Excellent** | No |
| **Zeek / Wazuh** | NSM / SIEM | No | N/A | **Use external host** | No |
| **ML on NPU** | Anomaly/scoring | Custom | Custom | Possible **research** | **Only for inference** |

---

## Recommendations for ImmortalWrt CM5 Base

### Tier 1 — ship in firmware (low risk, high value)

1. **`banip`** + **`luci-app-banip`** — enable WAN-triggered feeds (Emerging Threats, etc.).
2. Keep **`adblock`** for DNS threats; optionally install **`blocky`** from the feed.
3. **`tcpdump-mini`**, **`vnstat2`**, **`nlbwmon`** for operator visibility.

### Tier 2 — optional package / post-install

4. **`snort3`** — **IDS mode**, **`br-lan`** or **`lan`**, **minimal community rules**; add **[luci-snort3-openwrt](https://github.com/dddavid51/luci-snort3-openwrt)** to **`openwrt-packages`** if LuCI control is required.
5. Document **log rotation** and **RAM** (`/var` on overlay).

### Tier 3 — advanced

6. **External Docker host** — run **Suricata** or **Wazuh**; router **TEE** mirror or port mirror (CM5 image does not ship Docker).
7. **NPU** — defer unless product goal is **edge ML** (cameras, custom models); **not** for IDS acceleration in 2026 on stock ImmortalWrt.

---

## Implementation checklist (if adding Snort3 + banIP)

1. **`feeds install snort3 banip luci-app-banip`** (and dependencies: **`libdaq3`**, **`kmod-nft-queue`** if IPS).
2. Add to **`DEVICE_PACKAGES`** in **`armv8.mk`** or document **`opkg`** install from built **`packages/`** index.
3. **`/etc/config/snort`** — interface, **`manual=0`**, run **`snort-mgr check`**.
4. **`/etc/config/banip`** — **`ban_enabled`**, **`ban_trigger=wan`**, select feeds.
5. **Test throughput** with **`iperf3`** before/after; tune rules if IDS enabled.
6. **Do not enable** Suricata IPS + full ET rules on **2.5G** without measuring CPU.

---

## References (external)

- [Suricata OpenWrt PR #8659 (closed)](https://github.com/openwrt/packages/pull/8659)
- [openwrt/packages — snort3 Makefile](https://github.com/openwrt/packages/blob/master/net/snort3/Makefile)
- [openwrt/packages — banIP README](https://github.com/openwrt/packages/blob/master/net/banip/files/README.md)
- [luci-snort3-openwrt (community LuCI)](https://github.com/dddavid51/luci-snort3-openwrt)
- [Wazuh + Suricata + OpenWrt (traffic mirror)](https://blog.sienicki.eu/en/wazuh-suricata-ids-openwrt/)
- [OpenWrt forum — RK3588 NPU vs packet processing](https://forum.openwrt.org/t/how-to-use-rockchip-6tops-npu-to-accelerate-the-processing-of-network-packets/208582)
- [Linux kernel — accel/rocket NPU driver](https://docs.kernel.org/accel/rocket/index.html)
- [GL.iNet — IDS/IPS on router vs separate host](https://forum.gl-inet.com/t/ids-ips-intrusion-detection-prevention/43274)

## Related internal docs

- `openwrt-packages/docs/reticulum-nomadnet-openwrt-research.md`
- `openwrt-packages/docs/ssd1306-oled-openwrt-research.md`
- `immortal_opi_cm5/docs/FEATURES_AND_DEBUG.md` — CM5 **`DEVICE_PACKAGES`**, LuCI peripherals
