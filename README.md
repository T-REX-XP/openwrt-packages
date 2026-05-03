# openwrt-packages

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

Upstream **speedtest-go** remains on the normal packages feed; these recipes only add the LuCI front-end where applicable.

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
src-git --root=feeds openwrt_packages https://github.com/YOUR_USER/openwrt-packages.git;main
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

If you use ` build_immortalwrt/scripts/build-immortalwrt-macos.sh`, mount this feed without editing `feeds.conf`:

```sh
bash build-immortalwrt-macos.sh \
  --source /path/to/immortalwrt \
  --custom-feed /path/to/openwrt-packages/feeds
```

That appends `src-link openwrt_packages /custom-feed` inside the container.

See also `feeds.conf.snippet`.

## References

- [OpenWrt feeds](https://openwrt.org/docs/guide-developer/feeds)
