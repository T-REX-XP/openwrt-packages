# openwrt-packages

![CI](https://github.com/T-REX-XP/openwrt-packages/actions/workflows/ci.yml/badge.svg)

Personal OpenWrt / ImmortalWrt feed (layout aligned with [fantastic-packages/packages](https://github.com/fantastic-packages/packages)).

## Packages in this feed

| Path | Package |
|------|---------|
| `feeds/packages/blocky` | **blocky** — DNS proxy / ad-block (Go) |
| `feeds/luci/luci-app-blocky` | **luci-app-blocky** — LuCI for Blocky |
| `feeds/luci/luci-app-speedtest` | **luci-app-speedtest** — LuCI for speedtest-go |
| `feeds/luci/luci-app-security-guide` | **luci-app-security-guide** — security / privacy guide |
| `feeds/luci/luci-app-peripherals` | **luci-app-peripherals** — IR, PWM fan, diagnostics |
| `feeds/luci/luci-app-buttons` | **luci-app-buttons** — GPIO keys UI |
| `feeds/luci/luci-app-oled` | **luci-app-oled** — SSD1306 I2C OLED status (CM5: `/dev/i2c-1`, `br-lan`) |
| `feeds/luci/luci-app-snort3` | **luci-app-snort3** — LuCI for Snort3 IDS/IPS ([community upstream](https://github.com/dddavid51/luci-snort3-openwrt)) |

Upstream **speedtest-go** remains on the normal packages feed; these recipes only add the LuCI front-end where applicable.

Each LuCI app ships its own `*-theme.css` using **luci-theme-bootstrap** CSS variables (`--background-color-*`, `--text-color-*`, …), so **Bootstrap** (system / `prefers-color-scheme`), **BootstrapDark**, and **BootstrapLight** all render correctly without a shared theme library.

## IDS & traffic analysis (Orange Pi CM5)

OpenWrt routers are not datacenter IDS appliances. On **Orange Pi CM5 Base** (RK3588S, dual 2.5 GbE, ~8 GB RAM), a **layered** stack works better than running full signature IDS inline at wire speed. See **[docs/ids-traffic-analysis-openwrt-research.md](docs/ids-traffic-analysis-openwrt-research.md)** for Suricata status, Snort3 modes, NPU limits, and mirror-to-Docker patterns.

### Recommended packages by role

| Layer | Packages | Feed | CM5 fit |
|-------|----------|------|---------|
| **DNS threat filtering** | `blocky`, `luci-app-blocky` | **this feed** | Excellent — primary DNS filter in CM5 profile |
| | `adblock`, `luci-app-adblock` | ImmortalWrt `packages` / `luci` | Excellent — already in CM5 image |
| **IP blocklists (“mini-IPS”)** | `banip`, `luci-app-banip` | ImmortalWrt `packages` / `luci` | **Best add-on** — low CPU, nftables threat feeds |
| **Signature IDS** | `snort3`, `luci-app-snort3` | `snort3`: ImmortalWrt `packages`; LuCI: **this feed** | Good in **passive IDS** mode; IPS on 2.5 GbE needs tuning |
| **Traffic visibility** | `tcpdump-mini`, `vnstat2`, `luci-app-vnstat2` | ImmortalWrt feeds | Excellent — capture and per-interface volume |
| | `nlbwmon`, `luci-app-nlbwmon`, `luci-app-statistics` | ImmortalWrt feeds | Per-host accounting / graphs (in CM5 profile) |
| **Operator guide** | `luci-app-security-guide` | **this feed** | Security & privacy LuCI (CM5 profile) |
| **Heavy IDS / SIEM** | Suricata, Zeek, Wazuh | **Not** in official OpenWrt feed | Use **Docker on CM5** or a second host + traffic mirror |

**Not recommended on-router for CM5:** Suricata **IPS** at 2.5 GbE with large rule sets; RK3588 **NPU does not accelerate** Snort/Suricata packet paths (ML inference only).

### Suggested CM5 stack (tiers)

**Tier 1 — default (low risk, high value):** keep **`blocky`** + **`adblock`**; add **`banip`** + **`luci-app-banip`**; use **`tcpdump-mini`**, **`vnstat2`**, **`nlbwmon`** for visibility.

**Tier 2 — optional:** **`snort3`** + **`luci-app-snort3`** in **IDS** mode on `br-lan` with a **minimal** rule set; monitor CPU/RAM and log rotation.

**Tier 3 — advanced:** mirror WAN/LAN to a **Docker** container (CM5 image includes `docker`/`dockerd`) for Suricata or Wazuh — see the research doc.

### Install examples (ImmortalWrt 25.12+ / `apk`)

Packages from **this feed** (after enabling the feed — see below):

```sh
apk add blocky luci-app-blocky luci-app-security-guide luci-app-snort3
```

Packages from the **standard ImmortalWrt index** (built into the image or from upstream feeds):

```sh
apk add banip luci-app-banip snort3 tcpdump-mini vnstat2 luci-app-vnstat2
```

(`luci-app-snort3` is in **this feed**; install it with the first `apk add` line after enabling the feed.)

Enable **banIP** under *Services → banIP*; configure **Snort3** with `snort-mgr check` before starting IPS mode.

## Repository layout

```text
feeds/
  packages/<pkgname>/Makefile
  luci/<luci-app>/Makefile
```

## Option A — `src-git` (CI / other machines)

After pushing this repo:

```sh
cat <<-EOF >> feeds.conf.default
src-git --root=feeds openwrt_packages https://github.com/T-REX-XP/openwrt-packages.git;main
EOF
./scripts/feeds update openwrt_packages
./scripts/feeds install -p openwrt_packages -a
```

## Option B — `src-link` (local tree)

```sh
cat <<-EOF >> feeds.conf.default
src-link openwrt_packages /absolute/path/to/openwrt-packages/feeds
EOF
./scripts/feeds update openwrt_packages
./scripts/feeds install -p openwrt_packages -a
```

## Option C — ImmortalWrt macOS Docker helper

If you use ` build_immortalwrt/scripts/build-immortalwrt-macos.sh`, mount this feed without editing `feeds.conf`:

```sh
bash build-immortalwrt-macos.sh \
  --source /path/to/immortalwrt \
  --custom-feed /path/to/openwrt-packages/feeds
```

That appends `src-link openwrt_packages /custom-feed` inside the container.

See also `feeds.conf.snippet`.

## Option D — Install from published feed

GitHub Actions builds this feed **only for Orange Pi CM5 Base** (ImmortalWrt **25.12**, `rockchip/armv8` → **`aarch64_generic`** packages). SDK image: **`aarch64_generic-25.12-SNAPSHOT`** on [Docker Hub](https://hub.docker.com/r/immortalwrt/sdk/tags?name=aarch64_generic-25.12-SNAPSHOT) (aligned with release **25.12.0**).

### GitHub Pages (online feed)

**One-time repo setup** (required before the first Pages deploy; otherwise the Release workflow logs a 404 on deploy):

1. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions** (not “Deploy from a branch”).
2. Push a version tag (`v2026.06.16`) or re-run the **Release** workflow after step 1.

Enable signing key from the site root (after the first tagged release with `PUBLIC_KEY` configured):

```sh
# On the router (ImmortalWrt 25.12+ / apk) — CM5 example
wget -O /tmp/public-key.pem \
  https://t-rex-xp.github.io/openwrt-packages/public-key.pem
# Install the key per your image’s apk docs, then add a repository line pointing at:
# https://t-rex-xp.github.io/openwrt-packages/immortalwrt-25.12/aarch64_generic/
apk update
apk add blocky luci-app-blocky
```

Feed path on GitHub Pages:

| Device | Feed path |
|--------|-----------|
| Orange Pi CM5 Base (RK3588) | `immortalwrt-25.12/aarch64_generic/` |

### GitHub Releases (offline / air-gapped)

Push a version tag (`v2026.05.14`) to trigger a release build. Download **`openwrt_packages_aarch64_generic-immortalwrt-25.12-SNAPSHOT.tar.gz`** from [Releases](https://github.com/T-REX-XP/openwrt-packages/releases) and extract the `.apk` files locally, or verify with the attached `SHA256SUMS`.

### CI secrets (maintainers)

| Secret | Purpose |
|--------|---------|
| `PRIVATE_KEY` | Sign apk index on release builds |
| `PUBLIC_KEY` | Published as `public-key.pem` on GitHub Pages |
| `KEY_BUILD` / `KEY_BUILD_PUB` | Legacy ipk signing (optional) |

PR / push CI builds **unsigned** packages for compile verification only.

### Troubleshooting Release / Pages

| Symptom | Fix |
|---------|-----|
| `deploy-pages` **404** / “Ensure GitHub Pages has been enabled” | [Settings → Pages](https://github.com/T-REX-XP/openwrt-packages/settings/pages) → **Source: GitHub Actions**, then re-run the failed **Release** job |
| Node 20 deprecation notice in logs | Informational — GitHub runners default to Node 24; not related to Pages failures |
| GitHub Release succeeded, Pages job yellow/warning | Expected until Pages is enabled; `.apk` tarballs on [Releases](https://github.com/T-REX-XP/openwrt-packages/releases) still work |

## References

- [OpenWrt feeds](https://openwrt.org/docs/guide-developer/feeds)
- [CI plan](docs/ci-github-actions-plan.md)
- [CI/CD optimization report](docs/ci-github-actions-optimization.md)
- [luci-app-blocky feature plan](docs/luci-app-blocky-feature-plan.md)
- [SSD1306 OLED research](docs/ssd1306-oled-openwrt-research.md)
- [IDS / traffic analysis research (CM5)](docs/ids-traffic-analysis-openwrt-research.md)
