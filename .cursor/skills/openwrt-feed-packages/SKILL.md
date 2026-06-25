---
name: openwrt-feed-packages
description: >-
  Develop OpenWrt/ImmortalWrt packages in the openwrt-packages feed. Use when
  adding or editing Makefiles, init scripts, uci-defaults, conffiles, feed
  layout, blocky config, or cm5-button-scripts in feeds/packages/ or feeds/luci/.
---

# OpenWrt feed packages (openwrt-packages)

## Feed layout

```text
feeds/packages/<pkgname>/Makefile
feeds/luci/<luci-app>/Makefile
```

Feed name: **`openwrt_packages`**. Link **`feeds/`**, not the repo root.

## Package types

| Type | Path | Includes |
|------|------|----------|
| Binary / daemon | `feeds/packages/` | `package.mk`, init, `files/`, conffiles |
| LuCI app | `feeds/luci/` | `luci.mk`, `htdocs/`, `root/`, `po/` |

## Makefile conventions

- Bump **`PKG_RELEASE`** on every recipe change.
- Set **`PKG_MAINTAINER`** and **`PKG_LICENSE`** (Apache-2.0 for LuCI apps here).
- LuCI apps: stub `# call BuildPackage` in Makefile; real call is in `luci.mk`.
- Go packages: use `golang-package.mk`, set `GO_PKG_LDFLAGS_X` for version.

## LuCI app pattern (JS + rpcd)

Modern apps in this feed use **not** `luasrc/controller` + CBI:

```text
htdocs/luci-static/resources/view/<area>/<app>.js
htdocs/luci-static/resources/<app>-theme.css
root/usr/share/rpcd/ucode/luci.<app>.uc
root/usr/share/rpcd/acl.d/luci-app-<app>.json
root/usr/share/luci/menu.d/luci-app-<app>.json
po/en/<app>.po                    # optional; all UI strings via _()
```

- **`rpc.declare`:** always `expect: { '': {} }` for ucode rpcd backends.
- **ACL:** grant `read`/`write` for every path touched (UCI, sysfs, helper scripts).
- **Init scripts:** `$(INSTALL_BIN)` in `Package/.../install`; repo file mode `755`.
- **Theming:** scoped root `.luci-app-<name>`; Bootstrap CSS variables only (see `luci-bootstrap-theming`).

## luci-app-oled

- Daemon: `/usr/sbin/oledd` (menu) or legacy `/usr/bin/oled` (screensaver); UCI `menu_mode`.
- CM5 defaults: `/dev/i2c-7`, `menu_interactive=0`, `BTN_2` nav — via shipped UCI + `cm5-apply-config.sh`.
- Migration: `uci-defaults/99-oled-cm5-migrate` on sysupgrade.
- Go/C binary built in `src/` → `oledd-bin`; see skill **`oled-peripherals-cm5`**.

## luci-app-peripherals

- **Does not** write OLED UCI or start/stop `oledd`. OLED tab = I2C scan + read-only status.
- Fan/IR: sysfs + UCI `luci_peripherals`; debug report is read-only shell aggregation.
- No `board_info` blobs in RPC for LuCI tables — runtime diagnostics only.

## blocky package notes

- Config: `/etc/blocky/config.yml`, `/etc/config/blocky`
- Ports: DNS **`127.0.0.1:5353`**, HTTP/API **`127.0.0.1:4000`** (localhost only on router)
- Blocky 0.32+ schema: `loading.downloads.cachePath` (not top-level `loading.cachePath`)
- **List sync vs refresh:**
  - `blocky-lists-sync` — merge UCI `blocklist` sections into `config.yml` (LuCI/rpcd `sync_lists`)
  - `blocky-lists-refresh` — POST `/api/lists/refresh` on running Blocky (LuCI/rpcd `refresh_lists`)
  - Init runs sync before start; `blocky-boot` refreshes after WAN is up
- **dnsmasq:** `blocky-dnsmasq-sync enable|disable` sets `dhcp.@dnsmasq[].server=127.0.0.1#5353` (UCI `blocky.main.dnsmasq_forward`); use `uci set`, not `uci add_list` (`#` breaks BusyBox uci)
- **LuCI HTTP:** rpcd `luci.blocky` → `blocky-http-api` CLI (not browser `uclient-fetch` to localhost)
- Scripts: `blocky-config-apply`, `blocky-lists-sync` — avoid double sync on start
- YAML merge must emit **one copy** of each section (`upstreams`, `blocking`, `queryLog`, …)

## Install into a build tree

```sh
# feeds.conf.default
src-link openwrt_packages /absolute/path/to/openwrt-packages/feeds

./scripts/feeds update openwrt_packages
./scripts/feeds install -p openwrt_packages blocky luci-app-blocky
make package/blocky/compile V=s
```

Or via Docker helper:

```sh
build-immortalwrt-macos.sh --source /path/to/immortalwrt \
  --custom-feed /path/to/openwrt-packages/feeds
```

## Validation

- Syntax-check shell: `sh -n files/...`
- Syntax-check LuCI JS: `node --check htdocs/luci-static/resources/*.js`
- CI compiles all packages unsigned on push/PR

## Do not

- Point `src-link` at repo root (CI uses `FEED_DIR=.../feeds`)
- Skip `PKG_RELEASE` bump when changing installed files
- Add unrelated packages or refactor across apps in one change
- Assume packages are on `immortalwrt.org` — this is a third-party feed (compile-time link or published Pages/Releases apk)
