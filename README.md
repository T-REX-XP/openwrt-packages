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

GitHub Actions builds this feed for **ImmortalWrt 24.10** (`rockchip-armv8` / `aarch64_generic`, `x86_64`, and more on tagged releases). SDK images use the **`24.10-SNAPSHOT`** tags published on [Docker Hub](https://hub.docker.com/r/immortalwrt/sdk/tags?name=24.10-SNAPSHOT).

### GitHub Pages (online feed)

Enable **Settings → Pages → GitHub Actions** in the repo, then add the signing key from the site root (after the first tagged release with `PUBLIC_KEY` configured):

```sh
# On the router (ImmortalWrt 24.10+ / apk) — CM5 example
wget -O /tmp/public-key.pem \
  https://t-rex-xp.github.io/openwrt-packages/public-key.pem
# Install the key per your image’s apk docs, then add a repository line pointing at:
# https://t-rex-xp.github.io/openwrt-packages/immortalwrt-24.10/aarch64_generic/
apk update
apk add blocky luci-app-blocky
```

Architecture paths under the Pages site:

| Device class | Feed path |
|--------------|-----------|
| RK3588 / CM5, generic arm64 | `immortalwrt-24.10/aarch64_generic/` |
| Pi 4 / cortex-a53 | `immortalwrt-24.10/aarch64_cortex-a53/` |
| cortex-a72 SBCs | `immortalwrt-24.10/aarch64_cortex-a72/` |
| x86_64 VM / PC | `immortalwrt-24.10/x86_64/` |

### GitHub Releases (offline / air-gapped)

Push a version tag (`v2026.05.14`) to trigger a release build. Download the tarball for your architecture from [Releases](https://github.com/T-REX-XP/openwrt-packages/releases) and extract the `.apk` files locally, or verify with the attached `SHA256SUMS`.

### CI secrets (maintainers)

| Secret | Purpose |
|--------|---------|
| `PRIVATE_KEY` | Sign apk index on release builds |
| `PUBLIC_KEY` | Published as `public-key.pem` on GitHub Pages |
| `KEY_BUILD` / `KEY_BUILD_PUB` | Legacy ipk signing (optional) |

PR / push CI builds **unsigned** packages for compile verification only.

## References

- [OpenWrt feeds](https://openwrt.org/docs/guide-developer/feeds)
- [CI plan](docs/ci-github-actions-plan.md)
- [CI/CD optimization report](docs/ci-github-actions-optimization.md)
