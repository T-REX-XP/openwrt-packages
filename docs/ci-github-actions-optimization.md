# GitHub Actions CI/CD — optimization report

*Last updated: 2026-06-25. SDK target: ImmortalWrt **25.12.0** (`25.12-SNAPSHOT` Docker tags).*

This document records the initial pipeline review, gaps found, and the optimizations applied. It complements the original [CI plan](ci-github-actions-plan.md).

---

## Executive summary

The first CI/CD implementation was **functionally correct** (feed path, SDK action, release + Pages layout) but **not tuned** for GitHub Actions minutes, cancellation, or publish integrity.

After optimization:

| Metric | Before | After |
|--------|--------|-------|
| CI matrix (default) | 2 full SDK builds | **1** (`aarch64_generic-25.12-SNAPSHOT` / CM5) |
| CI on doc-only changes | Always runs | **Skipped** (`paths` filter) |
| Duplicate in-flight runs | Allowed | **Cancelled** (`concurrency`) |
| Release partial publish | Possible (`continue-on-error`) | **Blocked** — Pages verify step fails if feed URL 404 |
| Release blocked by Pages | Combined publish job | **Split** — `github-release` and `pages` jobs |
| CI workflow inactive | `ci.yml_` suffix | **`ci.yml`** (badge + PR builds) |
| Pages republish | Full SDK rebuild | **`skip_build`** workflow_dispatch (~2 min) |
| Artifacts per release arch | 2 (tarball + Pages tree) | **1** tarball |
| Shared build logic | Duplicated in 2 files | **Reusable workflow** |
| SDK action pin | `@master` | **Commit SHA** |
| Checkout depth (CI) | Full history | **Shallow** (`fetch-depth: 1`) |
| CI artifact upload | Every green run (~7d) | **Skipped** (upload on failure only; optional via manual dispatch) |
| Release publish jobs | 2 runners, 2× artifact download | **Split** `github-release` + `pages` (release not blocked by Pages env) |
| Workflows (entry points) | 3 files + 1 reusable | **Unchanged** — already minimal |

---

## Architecture (after optimization)

```text
.github/workflows/
  build-packages.yml   ← reusable: SDK build + optional artifacts
  ci.yml               ← PR/push: CM5 / aarch64_generic only
  release.yml          ← tag v*: CM5 only → Release + Pages
  dependabot.yml       ← weekly action updates
```

```mermaid
flowchart LR
  subgraph ci [CI]
    PR[PR / push feeds/**] --> RK[aarch64_generic build]
    RK --> Art[artifact 7d]
  end

  subgraph rel [Release tag v*]
    T[tag push] --> CM5[aarch64_generic / CM5]
    CM5 --> GR[GitHub Release job]
    CM5 --> PG[GitHub Pages job]
  end
```

---

## Caching strategy

OpenWrt/ImmortalWrt SDK builds run **inside Docker**. Most compile artifacts live in the container filesystem and are **not** visible to the host runner, so classic `actions/cache` on `dl/` or `build_dir/` does not apply without custom volume mounts.

### What is cached today

| Layer | Mechanism | Scope | Owner |
|-------|-----------|-------|-------|
| **SDK Docker image layers** | BuildKit `cache-from` / `cache-to` `type=gha` | Per `CONTAINER` + `ARCH` | [immortalwrt/gh-action-sdk](https://github.com/immortalwrt/gh-action-sdk) |
| **QEMU / Buildx setup** | Docker setup actions | Per runner job | gh-action-sdk |
| **Artifact upload** | `compression-level: 6` | Per artifact | Our workflows |

The SDK action cache key is effectively:

```text
scope = immortalwrt/sdk-<ARCH>
```

Examples: `immortalwrt/sdk-aarch64_generic-25.12-SNAPSHOT`.

**First run** for an architecture: slow (pull/build SDK image). **Subsequent runs** on the same arch: significantly faster layer reuse.

### What is not cached (and why)

| Candidate | Why skipped |
|-----------|-------------|
| Go module cache (`blocky`) | Downloads happen inside SDK container; path not on host workspace |
| OpenWrt `dl/` tarball cache | Same — inside container ephemeral FS |
| Host `~/.docker` | Redundant with BuildKit GHA cache for this action |
| Cross-job SDK reuse | Each matrix job is an isolated container run by design |

### Future caching options (if build times grow)

1. **Fork/patch gh-action-sdk** to bind-mount `dl/` and `ccache` to `/artifacts/.cache/` and add `actions/cache` on that directory keyed by `ARCH` + hash of `feeds/**/Makefile`.
2. **Self-hosted runner** with persistent SDK trees (heavy ops).
3. **Single-arch feed** — CM5 / `aarch64_generic` only (done).

---

## Optimizations implemented

### Tier 1 — reliability & cost control

| Change | File | Effect |
|--------|------|--------|
| `concurrency` + `cancel-in-progress` | `ci.yml`, `release.yml` | New pushes cancel stale runs |
| `timeout-minutes: 90/120` | `build-packages.yml` | Prevents 6h runaway jobs |
| `paths` filter (`feeds/**`, `.github/**`) | `ci.yml` | Skips SDK build for docs-only edits |
| Remove `continue-on-error` | `release.yml` | Release/Pages require all arches green |
| Pin SDK action SHA `c4848d7…` | `build-packages.yml` | Reproducible, safer builds |
| `fetch-depth: 1` | CI + release via reusable workflow | Faster checkout (`NO_REFRESH_CHECK` already true) |

### Tier 2 — faster CI

| Change | Effect |
|--------|--------|
| CM5-only CI and release | One SDK job per workflow run |
| Explicit **`PACKAGES`** list | Builds only feed packages, not accidental extras |

### Tier 3 — leaner release

| Change | Effect |
|--------|--------|
| **One artifact** `feed-<arch>.tar.gz` per matrix job | Half the artifact upload/download |
| Pages job **extracts tarballs** | No duplicate `public/` artifact |
| **Reusable workflow** | Single place for SDK env/toggles |

### Maintenance

| Change | Effect |
|--------|--------|
| `.github/dependabot.yml` | Weekly grouped updates for Actions |

---

## SDK image tags (ImmortalWrt 25.12.0)

ImmortalWrt publishes **`25.12-SNAPSHOT`** tags on Docker Hub for the **25.12.0** release line. Pinned **`-25.12.0`** image tags are **not** published (same pattern as 24.10).

| Role | `ARCH` env | Notes |
|------|------------|-------|
| Orange Pi CM5 Base (RK3588) | `aarch64_generic-25.12-SNAPSHOT` | ImmortalWrt `rockchip/armv8` → `aarch64_generic` packages |

CI and release build **this arch only**. `rockchip-armv8-25.12-SNAPSHOT` is not published on Docker Hub; `aarch64_generic-25.12-SNAPSHOT` matches CM5 install paths on the device.

Verify tags: [immortalwrt/sdk tags](https://hub.docker.com/r/immortalwrt/sdk/tags?name=25.12-SNAPSHOT).

---

## Secrets & signing

Unchanged from the [CI plan](ci-github-actions-plan.md):

| Secret | Used in |
|--------|---------|
| `PRIVATE_KEY` | Release builds (`INDEX=1`, apk signing) |
| `PUBLIC_KEY` | Published as `public-key.pem` on Pages |
| `KEY_BUILD` / `KEY_BUILD_PUB` | Legacy ipk (optional) |

CI and PR builds remain **unsigned** (no secrets required).

---

## Operational notes

### Enable GitHub Pages

**Settings → Pages → Build and deployment → Source: GitHub Actions**.

The Pages API (`GET /repos/.../pages`) returns **404** until this is done. Older workflows could show `deploy-pages` as green while the public site stayed 404.

**Fast republish** after enabling Pages (no ~40 min SDK build):

1. **Actions → Release → Run workflow**
2. Enable **skip_build** and **publish_pages**
3. Run — uses the latest [GitHub Release](https://github.com/T-REX-XP/openwrt-packages/releases) tarball

### Manual CI

**Actions → CI → Run workflow** — builds CM5 / `aarch64_generic` only. Artifacts are **not** uploaded by default; enable **Upload built packages** if you need the `.apk` tree from CI.

Failed CI runs still upload `bin/packages/` and `logs/` for debugging.

### Updating the pinned SDK action

When bumping [immortalwrt/gh-action-sdk](https://github.com/immortalwrt/gh-action-sdk):

1. Review upstream changelog.
2. Update the SHA in `.github/workflows/build-packages.yml`.
3. Run CI on a PR before merging.

Dependabot will propose updates to `actions/checkout`, `upload-artifact`, etc.; **review SDK action SHA bumps manually**.

---

## Remaining trade-offs

| Item | Decision |
|------|----------|
| PR + merge double CI | Accepted; `concurrency` limits waste on same branch |
| SNAPSHOT SDK drift | Accepted; ImmortalWrt does not ship pinned `-25.12.0` Docker tags |
| CM5-only release matrix | **Done** (`aarch64_generic-25.12-SNAPSHOT`) |
| No host-side Go/`dl/` cache | Not feasible without SDK action changes |
| CI success artifacts | **Skipped** — use GitHub Releases for installable packages |
| Three workflow files | **Keep** — reusable build + CI trigger + release trigger is the smallest clear split |

---

## References

- [ci-github-actions-plan.md](ci-github-actions-plan.md) — original design
- [immortalwrt/gh-action-sdk](https://github.com/immortalwrt/gh-action-sdk)
- [GitHub Actions concurrency](https://docs.github.com/en/actions/using-jobs/using-concurrency)
- [GitHub Actions cache](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)
- [Reusable workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflows)

### Pages release troubleshooting

| Symptom | Cause | Fix |
|---------|--------|-----|
| `release-dist/...tar.gz: No such file` on **skip_build** republish | `actions/checkout` ran after `gh release download` and wiped `release-dist/` | Fixed in workflow: checkout the feed generator script **before** downloading the tarball |
| **GitHub Pages** job fails in ~2s with **no steps** on **tag** releases (`v*`) | `github-pages` environment **deployment branch policy** allowed only `main`; tag refs are rejected before the job starts | **Settings → Environments → github-pages** → remove “Selected branches” restriction (allow all branches and tags), or rely on **skip_build** republish from `main` |
| Release workflow red but **SDK build** and **GitHub Release** succeeded | Usually the Pages job only — feed may still be stale on Pages until republish succeeds |

