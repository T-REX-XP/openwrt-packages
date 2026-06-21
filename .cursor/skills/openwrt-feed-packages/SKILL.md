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

## blocky package notes

- Config: `/etc/blocky/config.yml`, `/etc/config/blocky`
- Blocky 0.32+ schema: `loading.downloads.cachePath` (not top-level `loading.cachePath`)
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
