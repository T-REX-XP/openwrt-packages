---
name: openwrt-feed-ci-release
description: >-
  Build, test, and publish the openwrt-packages feed via GitHub Actions. Use when
  editing CI workflows, creating release tags, configuring GitHub Pages apk feed,
  apk signing secrets, or troubleshooting deploy-pages 404 errors.
---

# OpenWrt feed CI & release (openwrt-packages)

## CI (unsigned)

Workflow: `.github/workflows/ci.yml` (entry point; calls reusable `.github/workflows/build-packages.yml`)

- Runs on push/PR to verify packages compile
- Uses ImmortalWrt SDK Docker image (`aarch64_generic-25.12-SNAPSHOT`)
- **Must set:** `FEEDNAME=openwrt_packages`, `FEED_DIR=${{ github.workspace }}/feeds`

Without `FEED_DIR`, the action mounts repo root and finds no packages.

**Badge in README** points at `ci.yml` — do not rename without updating README.

## Release (signed + Pages)

Workflow: `.github/workflows/release.yml`

Triggered by version tags: `v2026.06.16`

**Target:** ImmortalWrt **25.12**, `aarch64_generic` (Orange Pi CM5 Base)

### GitHub Pages feed URL

```text
https://t-rex-xp.github.io/openwrt-packages/immortalwrt-25.12/aarch64_generic/
```

Public key: `https://t-rex-xp.github.io/openwrt-packages/public-key.pem`

### One-time Pages setup

Settings → Pages → Build and deployment → Source: **GitHub Actions**

Without this, the entire `https://t-rex-xp.github.io/openwrt-packages/` site returns **404** (Pages API also 404). Re-run Release after enabling.

**Fast republish** (no SDK rebuild): Actions → Release → Run workflow → **skip_build** + **publish_pages**.

### Router install (apk)

```sh
wget -O /etc/apk/keys/t-rex-xp.github.io.pub \
  https://t-rex-xp.github.io/openwrt-packages/public-key.pem
echo "https://t-rex-xp.github.io/openwrt-packages/immortalwrt-25.12/aarch64_generic/packages.adb" \
  >> /etc/apk/repositories.d/customfeeds.list
apk update
apk add blocky luci-app-blocky
```

### Offline install

Download from [GitHub Releases](https://github.com/T-REX-XP/openwrt-packages/releases):

`openwrt_packages_aarch64_generic-immortalwrt-25.12-SNAPSHOT.tar.gz`

Verify with attached `SHA256SUMS`.

## Maintainer secrets

| Secret | Purpose |
|--------|---------|
| `PRIVATE_KEY` | Sign apk index on release |
| `PUBLIC_KEY` | Published as `public-key.pem` on Pages (optional — derived from `PRIVATE_KEY` when unset) |
| `KEY_BUILD` / `KEY_BUILD_PUB` | Legacy ipk signing (optional) |

PR CI builds are **unsigned** — compile verification only.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Entire Pages site **404** | Enable Pages source: GitHub Actions; republish with **skip_build** |
| `deploy-pages` OK but URL 404 | Same — Pages was not provisioned |
| No packages found in CI | Set `FEED_DIR` to `feeds/` |
| CI never runs on PR | Ensure workflow is `.github/workflows/ci.yml` (not `ci.yml_`) |
| Tag build OK, no GitHub Release | Check `github-release` job (split from Pages) |

## Docs

- `docs/ci-github-actions-plan.md`
- `docs/ci-github-actions-optimization.md`
