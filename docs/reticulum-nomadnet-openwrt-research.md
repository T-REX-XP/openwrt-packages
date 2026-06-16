# Reticulum & NomadNet on OpenWrt / ImmortalWrt — Research Report

*Saved for internal planning. Last updated: 2026-05-14.*

## Summary

**Reticulum (RNS)** is an encrypted, mesh-oriented network stack (Python). **LXMF** adds messaging on top of RNS. **NomadNet** is a terminal-based client (urwid) for LXMF + Reticulum (pages, files, messaging). Shipping this on a router image means **Python 3**, **persistent storage**, and usually **daemon or SSH TUI** usage—not a drop-in LuCI app.

---

## Upstream projects

| Component | Role | Primary links |
|-----------|------|----------------|
| Reticulum (RNS) | Crypto mesh stack, pluggable interfaces (TCP/UDP/serial/LoRa, etc.) | [reticulum.network](https://reticulum.network/), [Reticulum manual — getting started](https://reticulum.community/manual/gettingstartedfast.html) |
| LXMF | Lightweight messaging over Reticulum | [markqvist/LXMF](https://github.com/markqvist/LXMF) |
| NomadNet | TUI client over LXMF + RNS | [markqvist/NomadNet](https://github.com/markqvist/nomadnet) |

NomadNet’s [README](https://github.com/markqvist/nomadnet) documents install via `pip`, optional **daemon** mode (`nomadnet --daemon`), and [Docker images](https://github.com/markqvist/nomadnet#docker-images) (`ghcr.io/markqvist/nomadnet`). The repo is described as a **[public mirror](https://github.com/markqvist/nomadnet/blob/master/MIRROR.md)**; packaging should pin versions and track license files in the actual release tarballs.

---

## NomadNet Python dependencies

From upstream [`setup.py`](https://raw.githubusercontent.com/markqvist/NomadNet/master/setup.py):

- **Python ≥ 3.8**
- `rns >= 1.2.5`
- `lxmf >= 0.9.7`
- `urwid >= 2.6.16`
- `qrcode`

OpenWrt needs these as **ipk** dependencies or a controlled `pip` install on writable storage—not a single static binary.

---

## OpenWrt / ImmortalWrt packaging landscape

There is **no** Reticulum/NomadNet in the main OpenWrt feeds today. Community packaging exists:

### feed-reticulum (gretel)

- **Repository:** [gretel/feed-reticulum](https://github.com/gretel/feed-reticulum)
- **Packages (per feed README):** `rns`, `rnspure` (pure-Python RNS), `lxmf`, `nomadnet`, `python3-urwid`; optional `*-src` packages.
- **Status:** README states the feed is **under active development and not yet ready for general use**, with emphasis on **Python module integration** in OpenWrt’s constrained layout and **procd** service wiring.
- **Example integration:** add to `feeds.conf`:
  `src-git reticulum https://github.com/gretel/feed-reticulum.git`
  then `./scripts/feeds update -a` / `feeds install` as usual.

### Build automation forks

Examples: [gretel/reticulum-openwrt](https://github.com/gretel/reticulum-openwrt), [Vitaliy86/reticulum-openwrt](https://github.com/Vitaliy86/reticulum-openwrt), [GrayHatGuy/reticulum-openwrt](https://github.com/GrayHatGuy/reticulum-openwrt) — CI-oriented builds for specific OpenWrt **arch/subtarget** profiles (feed README mentions aarch64, mips, x86_64, etc.). **aarch64** routers (e.g. RK358-class boards) are broadly compatible with that class of build, but **each image must be built against the exact SDK/toolchain** (e.g. ImmortalWrt rockchip/armv8).

### UCI / services (from feed README)

The feed documents example **UCI** + `service … start` for `rns`, `lxmf`, and `nomadnet` (config under `/etc/config/`, state under `/var/rns` in their examples). Treat as **reference only** until validated on your tree.

---

## Constraints on router images

1. **Flash / RAM** — RNS + LXMF + NomadNet + Urwid + transitive deps can be **tens of MB**; feasible on eMMC/SD with adequate rootfs/overlay; difficult on small NOR.
2. **Headless use** — Prefer **`nomadnet --daemon`** and/or **SSH + TUI** on the router; **LuCI** would require a **separate** app if a web UI is required.
3. **Python version** — Must match the **Python 3** version in your ImmortalWrt branch for binary modules (if any) and bytecode layout.
4. **Radios** — LoRa/packet-radio paths require **Reticulum interface configuration** for the specific hardware (TNC, serial, USB, etc.); see Reticulum documentation linked above.
5. **Docker on router** — Upstream publishes container images; on OpenWrt this is **optional** and adds operational complexity (not default).

---

## Integration strategies

| Strategy | Pros | Cons |
|----------|------|------|
| Add **feed-reticulum** to build | Reproducible ipk, aligns with OpenWrt service model | Experimental feed; ongoing merge/fix cost with ImmortalWrt |
| **`pip install` on overlay** | Quick experiment | Fragile across sysupgrades |
| **Docker** (upstream registry) | Isolated dependencies | Uncommon on stock images; networking bridging |
| **RNS + LXMF on router, NomadNet on a PC** | Smallest on-device footprint | No on-router NomadNet UI |

---

## License note for redistribution

[gretel/feed-reticulum README](https://github.com/gretel/feed-reticulum) lists **Nomadnet: GPL-3.0** while PyPI classifiers for the `nomadnet` package may show **MIT**. **Verify the `LICENSE` file in the exact sdist/wheel you ship** before publishing images or feeds.

---

## Recommended next steps (implementation)

1. **Spike compile** — Add the reticulum feed to a local ImmortalWrt tree, `feeds install` selected packages (`rns` or `rnspure`, `lxmf`, `nomadnet` as needed), `make package/.../compile` for **rockchip/armv8** (or your exact subtarget).
2. **Measure** — ipk sizes, RAM at idle, boot time with procd enabled.
3. **Define UX** — Document SSH + TUI vs daemon-only; decide if any LuCI scope is in scope later.
4. **Hardware path** — Start with one supported transport (e.g. TCP/UDP over LAN) before LoRa-specific guides.

---

## References (external)

- [NomadNet — GitHub](https://github.com/markqvist/nomadnet)
- [feed-reticulum — OpenWrt packages feed](https://github.com/gretel/feed-reticulum)
- [Reticulum — getting started (manual)](https://reticulum.community/manual/gettingstartedfast.html)
- [NomadNet on PyPI](https://pypi.org/project/nomadnet/)
