# Agent guide — openwrt-packages

Personal OpenWrt / ImmortalWrt feed for Orange Pi CM5 Base and related LuCI apps. Layout follows [fantastic-packages/packages](https://github.com/fantastic-packages/packages).

## Repository layout

```text
feeds/
  packages/<pkgname>/Makefile          # daemons, scripts, Go binaries
  luci/<luci-app-*>/Makefile           # LuCI front-ends
  luci/<luci-app-*>/htdocs/...         # JS, CSS, views
docs/                                  # CI plans, feature plans, research
.github/workflows/                     # build-packages.yml, release.yml
```

**Feed name (convention):** `openwrt_packages`

Consumers must link the **`feeds/`** directory — not the repo root:

```text
src-link openwrt_packages /absolute/path/to/openwrt-packages/feeds
```

## Packages in this feed

| Path | Package | Role |
|------|---------|------|
| `feeds/packages/blocky` | blocky | DNS proxy / ad-block (Go) |
| `feeds/packages/cm5-button-scripts` | cm5-button-scripts | GPIO key handlers |
| `feeds/luci/luci-app-blocky` | luci-app-blocky | Blocky LuCI dashboard |
| `feeds/luci/luci-app-speedtest` | luci-app-speedtest | speedtest-go UI |
| `feeds/luci/luci-app-security-guide` | luci-app-security-guide | Security & privacy guide |
| `feeds/luci/luci-app-peripherals` | luci-app-peripherals | IR, PWM fan, diagnostics |
| `feeds/luci/luci-app-buttons` | luci-app-buttons | GPIO keys UI |
| `feeds/luci/luci-app-oled` | luci-app-oled | SSD1306 I2C OLED (`/dev/i2c-1`, `br-lan`) |
| `feeds/luci/luci-app-snort3` | luci-app-snort3 | Snort3 IDS/IPS LuCI |

Upstream **speedtest-go** stays on the standard packages feed; this feed only ships the LuCI front-end.

## Development rules

1. **Minimize scope** — change only the package or app being worked on; match existing Makefile and file layout.
2. **Bump `PKG_RELEASE`** on every recipe change (packages and LuCI apps). Do not bump `PKG_VERSION` unless upgrading upstream.
3. **LuCI theming** — each app ships its own `*-theme.css`. Use **luci-theme-bootstrap** CSS variables (`--background-color-*`, `--text-color-*`, `--border-color-*`, `--error-color-high`, …). Support light, dark (`:root[data-darkmode]`), and system (`prefers-color-scheme`). No shared theme library.
4. **LuCI JS** — prefer CSS tone classes over inline hex/rgba for charts and bars. Wrap views in a scoped root class (e.g. `.luci-app-blocky`).
5. **Conffiles** — preserve `/etc/config/*` and service config paths in `conffiles`; document migration in init/uci-defaults when defaults change.
6. **Target platform** — CI builds for ImmortalWrt **25.12**, `rockchip/armv8` → **`aarch64_generic`** only.
7. **Commits** — only when the user explicitly asks. Never force-push or amend without permission.

## Integrating the feed (local build)

| Option | Method |
|--------|--------|
| A — remote | `src-git --root=feeds openwrt_packages https://github.com/T-REX-XP/openwrt-packages.git;main` |
| B — local | `src-link openwrt_packages /path/to/openwrt-packages/feeds` |
| C — Docker | `build-immortalwrt-macos.sh --custom-feed /path/to/openwrt-packages/feeds` |
| D — published | GitHub Pages: `https://t-rex-xp.github.io/openwrt-packages/immortalwrt-25.12/aarch64_generic/` |

After linking:

```sh
./scripts/feeds update openwrt_packages
./scripts/feeds install -p openwrt_packages -a
make package/blocky/compile V=s
make package/luci-app-blocky/compile V=s
```

## CI and release

- **PR/push CI** — unsigned compile verification (`.github/workflows/build-packages.yml`).
- **Tagged release** — signed `.apk` index + GitHub Pages feed (`.github/workflows/release.yml`).
- **Critical:** GitHub Actions must set `FEED_DIR: ${{ github.workspace }}/feeds` (Makefiles are not at repo root).
- **Pages setup:** Settings → Pages → Source: **GitHub Actions** (required before first deploy).

See `docs/ci-github-actions-plan.md` and `docs/ci-github-actions-optimization.md`.

## Orange Pi CM5 context

Primary device: **Orange Pi CM5 Base** (RK3588S, dual 2.5 GbE, ~8 GB RAM).

**Suggested security stack (tiers):**

- **Tier 1:** blocky + adblock + banip + traffic visibility (tcpdump-mini, vnstat2, nlbwmon)
- **Tier 2:** snort3 + luci-app-snort3 in **passive IDS** mode on `br-lan`
- **Tier 3:** mirror traffic to Docker for Suricata/Wazuh (not on-router)

**Avoid on-router:** Suricata IPS at 2.5 GbE; RK3588 NPU does not accelerate Snort/Suricata.

Full research: `docs/ids-traffic-analysis-openwrt-research.md`.

## Project skills

Use these Cursor skills when working in this repo:

| Skill | When to use |
|-------|-------------|
| `openwrt-feed-packages` | Adding or editing packages, Makefiles, init scripts, feed layout |
| `luci-bootstrap-theming` | LuCI views, JS dashboards, `*-theme.css`, responsive layout |
| `openwrt-feed-ci-release` | GitHub Actions, release tags, Pages feed, apk signing |
| `cm5-security-stack` | IDS/IPS, banIP, blocky, Snort3 mode and CM5 recommendations |

## Key references

- [README.md](README.md) — user-facing feed docs
- [docs/luci-app-blocky-feature-plan.md](docs/luci-app-blocky-feature-plan.md)
- [docs/ssd1306-oled-openwrt-research.md](docs/ssd1306-oled-openwrt-research.md)
- [OpenWrt feeds guide](https://openwrt.org/docs/guide-developer/feeds)
