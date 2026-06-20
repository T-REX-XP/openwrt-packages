# GitHub Actions — build & publish plan for `openwrt-packages`

*Investigation for [T-REX-XP/openwrt-packages](https://github.com/T-REX-XP/openwrt-packages). Last updated: 2026-05-14.*

## Goal

Automate **compile → test → publish** of this custom feed so users can install **`blocky`**, **`luci-app-*`**, etc. without cloning the repo or using `--custom-feed` on every ImmortalWrt build.

Primary target: **ImmortalWrt** on **rockchip / armv8 / aarch64_generic** (Orange Pi CM5 Base). Secondary: **OpenWrt 24.10+** for generic **`aarch64_generic`** / **`x86_64`**.

---

## Repository facts

| Item | Value |
|------|--------|
| Remote | `https://github.com/T-REX-XP/openwrt-packages.git` |
| Default branch | `main` |
| Feed layout | `feeds/packages/*`, `feeds/luci/*` (see [README.md](../README.md)) |
| Feed name (convention) | `openwrt_packages` |
| Packages (7) | `blocky`; `luci-app-blocky`, `luci-app-speedtest`, `luci-app-security-guide`, `luci-app-peripherals`, `luci-app-buttons` |

**Important:** Consumers use either:

```text
src-git --root=feeds openwrt_packages https://github.com/T-REX-XP/openwrt-packages.git;main
```

or **`src-link`** / **`--custom-feed`** pointing at the **`feeds/`** directory — not the repo root.

---

## Recommended tooling

### ImmortalWrt (primary)

| Component | URL |
|-----------|-----|
| GitHub Action | [immortalwrt/gh-action-sdk](https://github.com/immortalwrt/gh-action-sdk) (fork of OpenWrt action) |
| SDK Docker image | [immortalwrt/sdk](https://hub.docker.com/r/immortalwrt/sdk) on Docker Hub |
| SDK tarballs (reference) | e.g. [ImmortalWrt 24.10.5 rockchip armv8 SDK](https://mirrors.zju.edu.cn/immortalwrt/releases/24.10.5/targets/rockchip/armv8/) |

### OpenWrt (optional second column)

| Component | URL |
|-----------|-----|
| GitHub Action | [openwrt/gh-action-sdk](https://github.com/openwrt/gh-action-sdk) |
| SDK Docker image | `openwrt/sdk` |

Both actions:

- Mount your checkout as **`/feed`** inside the SDK container.
- Append `src-link $FEEDNAME /feed/` to `feeds.conf`.
- Run `feeds update`, `feeds install`, `make package/.../compile`.
- Support **`INDEX=1`**, signing keys, **`PACKAGES`**, **`EXTRA_FEEDS`**.

Docs: [openwrt/gh-action-sdk README](https://github.com/openwrt/gh-action-sdk/blob/main/README.md).

---

## Critical configuration: `FEED_DIR`

The action defaults to mounting **the repo root** at `/feed`. Your Makefiles live under **`feeds/packages/`** and **`feeds/luci/`**, not at the root.

**You must set:**

```yaml
env:
  FEEDNAME: openwrt_packages
  FEED_DIR: ${{ github.workspace }}/feeds
```

Without this, `feeds install -p openwrt_packages` finds **no packages**.

This matches [README Option B](../README.md) (`src-link …/feeds`) and **`build-immortalwrt-macos.sh --custom-feed …/feeds`**.

---

## Package format: `.apk` vs `.ipk`

Recent **ImmortalWrt** / **OpenWrt 24.10+** images use **`apk`** packages (not only `ipk`). CM5 builds in this project produce **`*.apk`** under `bin/packages/…`.

| Format | Signing env (gh-action-sdk) | Artifact glob |
|--------|----------------------------|---------------|
| **apk** | `PRIVATE_KEY` (+ publish `public-key.pem`) | `bin/packages/*/*/*.apk` |
| **ipk** (legacy) | `KEY_BUILD` (+ `key-build.pub`) | `*.ipk` |

Plan: **publish `.apk` first**; add `.ipk` matrix rows only if you still support 21.02/23.05 consumers.

---

## Architecture matrix (what to build)

### Phase 1 — CI (every PR / push to `main`)

| SDK | `ARCH` | Why |
|-----|--------|-----|
| ImmortalWrt | `aarch64_generic` or `aarch64_generic-24.10.5` | CM5 / rockchip armv8 |
| ImmortalWrt (optional) | `x86_64` | Fast sanity check on runner |

Build **all feed packages** (no `PACKAGES` filter) or explicit list:

```text
blocky luci-app-blocky luci-app-speedtest luci-app-security-guide luci-app-peripherals luci-app-buttons
```

Upload **`bin/packages/`** + **`logs/`** as workflow artifacts (7-day retention).

### Phase 2 — Release (git tag `v*`)

Expand matrix (pick subset to control minutes):

| `ARCH` | Audience |
|--------|----------|
| `aarch64_generic` | RK3588 / CM5, most arm64 routers |
| `aarch64_cortex-a53` | Pi 4 class |
| `aarch64_cortex-a72` | Pi 4 / some SBCs |
| `x86_64` | PC / VM routers |

Pin SDK version in `ARCH` for reproducible releases, e.g. **`aarch64_generic-24.10.5`**, not floating snapshot.

Reference multi-arch release pattern: [OpenWrt-nikki `release-packages.yml`](https://github.com/nikkinikki-org/OpenWrt-nikki/blob/master/.github/workflows/release-packages.yml).

---

## Build dependencies (expectations)

| Package | Notes |
|---------|--------|
| **blocky** | Go cross-compile via SDK **`feeds/packages/lang/golang`**; downloads upstream tarball (needs network in CI). |
| **luci-app-blocky** | `LUCI_PKGARCH:=all`; depends **`+blocky`**. |
| **luci-app-speedtest** | Depends **`+speedtest-go`** from **stock packages feed** (SDK default feeds — do not set `NO_DEFAULT_FEEDS`). |
| **luci-app-security-guide** | LuCI-only. |
| **luci-app-peripherals** | LuCI all-arch; **`DEPENDS`** on **`v4l-utils`**, **`kmod-ir-gpio-cir`**, **`kmod-hwmon-pwmfan`** — should resolve from SDK feeds; runtime only meaningful on CM5-like hardware. |
| **luci-app-buttons** | Depends **`kmod-gpio-button-hotplug`**. |

**First-time CI toggles:**

```yaml
NO_REFRESH_CHECK: true    # no patches/ in feed yet
NO_SHFMT_CHECK: true      # or run shfmt on blocky.init / luci-peripherals init locally
V: s                       # verbose logs on failure
```

---

## Publish strategy (choose one or combine)

### Option A — GitHub Releases only (recommended MVP)

**Flow:** tag `v2026.05.14` → workflow builds matrix → **`softprops/action-gh-release`** uploads per-arch **`tar.gz`**:

```text
openwrt_packages_aarch64_generic-24.10.5.apk.tar.gz
```

Contents: `bin/packages/aarch64_generic/openwrt_packages/*.apk` + **`Packages`** index if `INDEX=1`.

**Pros:** Simple, no extra hosting, works with manual `opkg`/`apk` install.  
**Cons:** Users must pick the right arch tarball; no single “feed URL” until Option B.

### Option B — GitHub Pages static feed (recommended for `opkg`/`apk` add)

After matrix jobs, a **`feed`** job (like Nikki):

1. Download all arch artifacts.
2. Merge into `public/<branch>/<arch>/`.
3. Drop **`public-key.pem`** / **`key-build.pub`** at site root.
4. Generate **`index.html`** (optional `tree` listing).
5. Deploy with **`peaceiris/actions-gh-pages`** or **`actions/upload-pages-artifact`**.

**User-facing URL example:**

```text
https://t-rex-xp.github.io/openwrt-packages/immortalwrt-24.10/aarch64_generic/
```

**Pros:** One URL per arch; standard OpenWrt feed consumption.  
**Cons:** Needs signing keys in repo secrets; Pages bandwidth limits.

### Option C — Cloudflare Pages

Same as B but deploy via **`cloudflare/wrangler-action`** ([Nikki feed job](https://github.com/nikkinikki-org/OpenWrt-nikki/blob/master/.github/workflows/release-packages.yml)).

### Option D — Release + README only (no web feed)

Attach `.apk` files directly to GitHub Release; document **`apk add`** / **`opkg install`** from release assets. Minimal ops.

**Recommendation:** **A + B** — Releases for versioned tarballs; **`gh-pages`** for day-to-day **`apk update`**.

---

## Secrets & signing

| Secret | Purpose |
|--------|---------|
| `PRIVATE_KEY` | Sign **apk** feed (ImmortalWrt 24.10+) |
| `PUBLIC_KEY` | Published as `public-key.pem` on feed site |
| `KEY_BUILD` | Sign **ipk** (if you ship ipk) |
| `KEY_BUILD_PUB` | Published as `key-build.pub` |
| `GITHUB_TOKEN` | Releases / Pages (default permissions) |

Generate keys once on a build machine:

```sh
# apk (ImmortalWrt/OpenWrt 24.10+ style — follow SDK docs in container)
# usign (ipk legacy)
```

Store **private** keys only in GitHub **Settings → Secrets → Actions**. Never commit private keys.

For **unsigned** test CI on PRs: omit keys; set `INDEX=0` or accept unsigned local install only.

---

## Planned workflows

### 1. `.github/workflows/ci.yml` — continuous build

| Trigger | `pull_request` → `main`, `push` → `main` |
| Permissions | `contents: read` |
| Jobs | `build` (matrix 1–2 arch), `upload-artifact` |
| Fails PR | Yes, if compile fails |

```yaml
# Sketch — implement when ready
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - arch: aarch64_generic-24.10.5
            action: immortalwrt/gh-action-sdk@master
          # - arch: x86_64-24.10.5
          #   action: immortalwrt/gh-action-sdk@master

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Build packages
        uses: immortalwrt/gh-action-sdk@master
        env:
          ARCH: ${{ matrix.arch }}
          FEEDNAME: openwrt_packages
          FEED_DIR: ${{ github.workspace }}/feeds
          NO_REFRESH_CHECK: true
          NO_SHFMT_CHECK: true
          V: s

      - name: Upload packages
        uses: actions/upload-artifact@v4
        with:
          name: packages-${{ matrix.arch }}
          path: |
            bin/packages/**/*
            logs/**/*
          if-no-files-found: error
```

### 2. `.github/workflows/release.yml` — tag publish

| Trigger | `push` tags matching `v*` |
| Permissions | `contents: write` |
| Jobs | `build` (matrix) → `release` (GitHub Release) → optional `pages` |

Env extras for release:

```yaml
INDEX: 1
PRIVATE_KEY: ${{ secrets.PRIVATE_KEY }}
# KEY_BUILD: ${{ secrets.KEY_BUILD }}  # if ipk
PACKAGES: blocky luci-app-blocky luci-app-speedtest luci-app-security-guide luci-app-peripherals luci-app-buttons
```

Release job attaches:

- Per-arch **`openwrt_packages_${ARCH}.tar.gz`**
- **`SHA256SUMS`**
- Optional **`manifest.txt`** (package names + versions from `Packages` index)

### 3. `.github/workflows/pages-feed.yml` (optional, after release or on `main`)

| Trigger | `workflow_run` after successful release, or manual `workflow_dispatch` |
| Deploy | GitHub Pages branch / custom domain |

---

## README / consumer documentation updates

After CI is live, extend [README.md](../README.md):

1. Replace **`YOUR_USER`** with **`T-REX-XP`** in `feeds.conf.snippet`.
2. Add **Option D — Install from published feed**:

   ```sh
   # Example — adjust URL after Pages deploy
   wget -O - https://t-rex-xp.github.io/openwrt-packages/immortalwrt-24.10/aarch64_generic/public-key.pem \
     > /etc/apk/keys/...
   # add repository line per ImmortalWrt apk docs
   apk add blocky luci-app-blocky
   ```

3. Link to **GitHub Releases** for offline/air-gapped `.apk` install.
4. Badge: `![CI](https://github.com/T-REX-XP/openwrt-packages/actions/workflows/ci.yml/badge.svg)`

---

## Implementation checklist

| Step | Task | Priority |
|------|------|----------|
| 1 | Add `.github/workflows/ci.yml` with **`FEED_DIR=…/feeds`**, **`FEEDNAME=openwrt_packages`** | P0 |
| 2 | Fix first CI failures (Go fetch, shfmt, missing deps) | P0 |
| 3 | Pin **`ARCH`** to ImmortalWrt **24.10.5** (or your image’s release) | P0 |
| 4 | Generate signing keys; add GitHub secrets | P1 |
| 5 | Add `.github/workflows/release.yml` on **`v*`** tags | P1 |
| 6 | Enable GitHub Pages feed layout | P2 |
| 7 | Update README + `feeds.conf.snippet` with real URLs | P1 |
| 8 | Optional: dual **`openwrt/gh-action-sdk`** job for vanilla OpenWrt users | P3 |
| 9 | Optional: **`workflow_dispatch`** rebuild without tag | Done |
| 10 | CI/CD optimizations (concurrency, caching, reusable workflow) | Done — see [ci-github-actions-optimization.md](ci-github-actions-optimization.md) |

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| SDK snapshot drift breaks builds | Pin **`ARCH=…-24.10.5`** on release; test snapshot on `main` weekly |
| Long matrix → GitHub minutes | CI: 1 arch; release: 2–4 archs only |
| **`blocky` upstream hash** change | PR CI catches; bump `PKG_HASH` in Makefile |
| Wrong feed path | Always **`FEED_DIR: …/feeds`** in env |
| Unsigned feed rejected on device | Document key install; use **`PRIVATE_KEY`** on release |
| **`luci-app-peripherals`** kmods missing on non-rockchip | Document “CM5-oriented”; package still builds as all-arch LuCI |

---

## References

- [openwrt-packages README](../README.md)
- [openwrt/gh-action-sdk](https://github.com/openwrt/gh-action-sdk)
- [immortalwrt/gh-action-sdk](https://github.com/immortalwrt/gh-action-sdk)
- [OpenWrt-nikki release-packages workflow (matrix + Pages feed)](https://github.com/nikkinikki-org/OpenWrt-nikki/blob/master/.github/workflows/release-packages.yml)
- [ImmortalWrt rockchip armv8 SDK 24.10.5](https://mirrors.zju.edu.cn/immortalwrt/releases/24.10.5/targets/rockchip/armv8/)
- [OpenWrt feeds documentation](https://openwrt.org/docs/guide-developer/feeds)

## Related internal docs

- `docs/ids-traffic-analysis-openwrt-research.md` — **`banIP`/`snort3`** (future feed candidates)
- `build_immortalwrt` — **`--custom-feed`** local build path
