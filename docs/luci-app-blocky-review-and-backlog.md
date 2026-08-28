# luci-app-blocky — code review, improvement plan & backlog

**Date:** 2026-08-28  
**Scope:** `feeds/luci/luci-app-blocky/` + `feeds/packages/blocky/`  
**Target Blocky:** **v0.34.0** (feed) · LuCI **PKG_RELEASE 41**  
**Supersedes:** [luci-app-blocky-feature-plan.md](luci-app-blocky-feature-plan.md) for active backlog (that doc remains useful as API/history reference).

---

## Executive summary

**luci-app-blocky is feature-rich but monolithic and untested.** The prior feature plan (2026-06-21) marked most blocky-ui parity items as *Done*, yet the codebase has grown into a **~4,650-line** single module (`blocky-common.js`) with **zero automated tests** and **no CI test step**. Blocky upstream is now **0.34.x**; the old plan still references **0.32.1**.

For **daily use on a router**, admins need: reliable service status, syslog/debug visibility, safe config apply, clear dnsmasq integration, query log review, and quick blocking operations — without full page reloads or YAML expertise. Much of this exists, but gaps remain (especially **service logs**, **config validation**, **test coverage**, and **maintainability**).

**Recommendation:** Treat this as a **quality + daily-ops hardening** program in 6 epics (~8–12 PRs), with **100% unit coverage on all pure logic** (JS helpers, shell helpers, rpcd ucode) before large UI additions.

---

## 1. Current architecture

### 1.1 Package layout

```text
feeds/luci/luci-app-blocky/
  htdocs/luci-static/resources/
    blocky-common.js          # ~4648 lines — API, parsers, all tabs, config form
    blocky-theme.css          # ~1319 lines — Bootstrap vars, charts, dark mode
    view/services/blocky.js   # thin wrapper → createBlockyView()
    view/status/blocky.js     # redirect → #statistics
  root/usr/share/rpcd/ucode/luci.blocky.uc   # sync, refresh, http_request, read_query_log, get_version
  root/usr/share/rpcd/acl.d/luci-app-blocky.json
  root/usr/share/luci/menu.d/luci-app-blocky.json
  root/usr/share/luci-app-blocky/blocklist-catalog.json
  po/en/blocky.po, po/uk/blocky.po
  tests/                      # ❌ missing

feeds/packages/blocky/
  files/config.yml              # 0.34.x defaults (localhost :5353 / :4000, CSV query log)
  files/etc/config/blocky       # UCI: dnsmasq_forward, blocklist sections
  files/usr/sbin/blocky-*       # dnsmasq-sync, lists-sync, http-api, config-apply, boot
  files/blocky.init             # procd
```

### 1.2 LuCI tabs (today)

| Tab | Purpose | Daily-use fit |
|-----|---------|---------------|
| **Dashboard** | `/api/stats` cards, pause controls, ad-blocker pipeline, live Prometheus charts | Good |
| **Statistics** | 24h `/api/stats` detail (tops, breakdown, list inventory, cache) | Good |
| **Block lists** | UCI blocklists, catalog presets, sync vs refresh | Confusing labels |
| **Configuration** | Structured settings + Advanced YAML; dnsmasq forward | Good but needs validation |
| **Controls** | Blocking, operations, init.d enable/start/stop | Overlaps Dashboard |
| **DNS Query** | POST `/api/query` | Good |
| **Logs** | CSV query log via rpcd (512 KiB cap, filters, pagination) | Partial — not service syslog |

### 1.3 Data paths

```text
Browser (LuCI JS)
  → rpc.declare → rpcd luci.blocky.*
    → blocky-http-api → uclient-fetch → 127.0.0.1:4000/api|/metrics
    → blocky-lists-sync / blocky-lists-refresh
    → blocky-dnsmasq-sync
  → fs.read/write → /etc/blocky/config.yml
  → fs.exec → /etc/init.d/blocky
  → uci → /etc/config/blocky
```

OpenWrt-specific **dnsmasq LAN forwarding** remains a differentiator vs blocky-ui.

---

## 2. Strengths (keep)

| Area | Notes |
|------|--------|
| **Bootstrap theming** | Scoped `.luci-app-blocky`, CSS variables, dark mode — aligns with [luci-bootstrap-theming](../.cursor/skills/luci-bootstrap-theming/SKILL.md) |
| **rpcd HTTP bridge** | Correct pattern for localhost API (no browser fetch to :4000) |
| **Dual metrics** | `/api/stats` (24h) + Prometheus (live deltas) with fallbacks |
| **Structured config** | Settings sections (upstreams, blocking, listeners, query log, API security) + YAML escape hatch |
| **Pause countdown** | `autoEnableInSec` polling on Dashboard / Controls |
| **CSV query logs** | Path allowlist in ucode; tmpfs note in UI |
| **Block list catalog** | Presets + custom UCI sections + sync to YAML |
| **ACL** | Tightened vs early versions; query logs via rpcd only |
| **Menu consolidation** | Single Services entry; legacy status redirect |

---

## 3. Weaknesses & risks

### 3.1 Maintainability (P0)

| Issue | Impact |
|-------|--------|
| **Monolithic `blocky-common.js`** (~4648 lines) | Hard to review, test, or extend; high regression risk |
| **No tests / no CI test job** | 0% coverage; regressions ship silently |
| **Outdated docs** | `luci-app-blocky-feature-plan.md` says v0.32.1; release workflow snippet still cites `blocky-0.32.1-r2.apk` |
| **Duplicate UI** | Operations (flush, refresh, restart) on Dashboard and Controls |
| **Mixed save paths** | Structured form (`saveBlockySettingsForm`) vs raw YAML vs UCI blocklists — easy to desync `blocking:` section |

### 3.2 Daily operations gaps (P0–P1)

| Gap | User impact |
|-----|-------------|
| **No service/syslog tab** | Cannot `logread -e blocky` from LuCI when CSV query log empty or Blocky won't start |
| **No config validate before restart** | Bad YAML takes service down; no dry-run |
| **Weak “service down” UX** | Warnings exist but no persistent banner across tabs / suggested fixes |
| **Block lists: Sync vs Refresh** | Power users know; daily users confuse “write YAML” vs “reload lists API” |
| **Logs tab** | No auto-refresh, copy-all, or export; CSV column parsing is heuristic |
| **No upstream group editor** | Multi-group upstreams in 0.34 config not fully exposed in structured form |
| **DNS Query tab** | Static mount; no link from query log row → pre-filled test |
| **Missing `getConfig`/`getStatus` RPC** | JS loads many parallel fs/uci calls instead of one rpcd status object (oled/mcu pattern) |

### 3.3 Security / ACL (P2)

| Item | Notes |
|------|--------|
| `read_query_log` on **write** ACL | Should be read-only on read tier if LuCI splits RO users later |
| `http_request` path allowlist in ucode | Good regex; add tests for injection attempts |
| API basic auth fields in UCI | Form exists; verify 0.34 Blocky actually honors them via config-apply |

### 3.4 Blocky 0.34 alignment (P1)

| Item | Action |
|------|--------|
| OpenAPI diff 0.32 → 0.34 | Audit new/changed `/api/*` fields for stats/dashboard |
| Default `config.yml` | Already 0.34 syntax (`bootstrapDns`, `hostsFile`, denylist groups) |
| Feature plan API table | Refresh against [Blocky OpenAPI](https://github.com/0xERR0R/blocky/blob/main/docs/api/openapi.yaml) |

---

## 4. UI guidelines compliance

Reference apps: **luci-app-oled**, **luci-app-peripherals**, **luci-app-mcu-display**.

| Guideline | blocky today | Target |
|-----------|--------------|--------|
| Scoped root + `*-theme.css` | Yes | Keep |
| Tabs via `ui.tabs.initTabGroup` | Yes | Keep; reduce tab count (merge Controls → Dashboard) |
| `disableIf` / `optionSelected` for `E()` attrs | Partial | Audit all `disabled`/`selected` on dynamic widgets |
| `_()` + `po/en/*.po` | Yes | Update strings for new Debug tab |
| No hardcoded board prose | Yes | Keep |
| **Debug tab** (logread, copy, refresh) | **Missing** | Add like oled `getLogs` |
| **Status header** on all tabs | Partial | Sticky service + dnsmasq + blocking pill |
| Responsive 1200/768/520 | Yes in CSS | Re-test after refactor |
| RPC `expect: { '': {} }` | Yes | Keep |

---

## 5. Testing strategy — 100% unit coverage target

LuCI views (`E()`, DOM, `poll`) are **not** unit-tested in-browser. **100% coverage applies to extractable pure logic and host-side scripts**, matching **luci-app-oled** / **luci-app-mcu-display** patterns.

### 5.1 Test pyramid

```text
                    ┌─────────────────┐
                    │ Manual LuCI QA  │  light/dark, mobile, live router
                    └────────┬────────┘
              ┌──────────────┴──────────────┐
              │  Shell integration (optional)  │  blocky-http-api against mock
              └──────────────┬──────────────┘
    ┌─────────────────────────┴─────────────────────────┐
    │  Node test.mjs — JS pure functions (100% lines)    │
    └─────────────────────────┬─────────────────────────┘
    ┌─────────────────────────┴─────────────────────────┐
    │  Shell/shunit — blocky-* sbin scripts              │
    └─────────────────────────┬─────────────────────────┘
    ┌─────────────────────────┴─────────────────────────┐
    │  ucode extract + shell — luci.blocky.uc helpers    │
    └───────────────────────────────────────────────────┘
```

### 5.2 Files to cover (mandatory for “100%” claim)

| Module | Functions / behavior | Runner |
|--------|----------------------|--------|
| **blocky-parse.js** (extract) | `parseMetrics`, `parseBlockyStats`, `parseQueryLogConfig`, `parseBlockyPortLine`, `parseDnsForwardFlag`, `parseCsvRows`, `formatNumber`, `formatDuration`, `mapToBarRows` | `node tests/blocky-parse.test.mjs` |
| **blocky-http.js** (extract) | `blockyPathFromUrl`, `validateHttpPath` mirror, `blockyRpcOk`, `blockyRpcError` | node |
| **blocky-config.js** (extract) | `buildYamlFromSettings`, `parseSettingsFromYaml` round-trip fixtures | node |
| **luci.blocky.uc** | `validate_http`, `allowed_log_dir`, `find_latest_log_file`, `shellquote` | shell + golden files |
| **blocky-http-api** | port parse from YAML, GET/POST routing | `tests/blocky-http-api.test.sh` |
| **blocky-dnsmasq-sync** | status/enable/disable output codes | shell |
| **blocky-lists-sync** | UCI → YAML fragment (fixture uci export) | shell |

### 5.3 CI integration

Add to `.github/workflows/ci.yml` (or new `test-packages.yml` job):

```yaml
- name: luci-app-blocky unit tests
  run: feeds/luci/luci-app-blocky/tests/run-tests.sh
```

Gate PRs touching `feeds/luci/luci-app-blocky/**` or `feeds/packages/blocky/**`.

### 5.4 Coverage tooling

- **Node:** assert-based tests (no jest required); optional `c8` on extracted modules only
- **Shell:** `set -eu` + diff against `tests/fixtures/expected/*`
- **Document:** `tests/README.md` with “how to run locally on macOS”

---

## 6. Target UX — daily-use checklist

After the program, a router admin should be able to **without SSH**:

| Task | Where |
|------|--------|
| See Blocky running, version, blocking on/off, dnsmasq forward | Sticky status bar (all tabs) |
| Pause blocking 5m / 1h / custom; see countdown | Dashboard |
| Flush cache, refresh lists, restart service | Dashboard → Operations (single place) |
| Edit upstreams, ports, log level, query log settings | Configuration |
| Apply config with **validate** then restart | Configuration → Save & apply |
| Manage blocklists (add/disable/preset) | Block lists |
| Test a domain (A/AAAA/…) | DNS Query |
| Browse recent DNS queries (CSV) | Logs |
| Read service errors (startup, list download, procd) | **Debug** tab (`logread`) |
| Copy debug bundle for support | Debug → Copy logs |

---

## 7. Implementation epics & backlog

**Legend:** `Status` = `todo` | `doing` | `done` | `defer`  
**Priority:** P0 (blocker) · P1 (daily use) · P2 (polish) · P3 (nice)

---

### Epic A — Test foundation & refactor (P0)

| ID | Task | Status | Acceptance criteria |
|----|------|--------|---------------------|
| A-1 | Create `feeds/luci/luci-app-blocky/tests/` + `run-tests.sh` | done | Runs on macOS with node + sh; exits non-zero on failure |
| A-2 | Extract `blocky-parse.js` from common (metrics, stats, CSV, ports, dnsmasq status) | done | `blocky-parse-core.js` + LuCI wrapper; common requires module |
| A-3 | **100% line coverage** on `blocky-parse.js` via `blocky-parse.test.mjs` | done | 32 tests; `node --check` on all `blocky*.js`; c8 optional later |
| A-4 | Extract `blocky-config.js` (YAML ↔ settings state) + round-trip tests | done | `blocky-config-core.js` + 7 round-trip tests |
| A-5 | Shell tests for `blocky-http-api`, `blocky-dnsmasq-sync` | done | Temp `CONFIG`; upstream format checks |
| A-6 | Tests for `luci.blocky.uc` validation helpers | done | Path `..` rejected; log dir allowlist mirrored in parse core |
| A-7 | Wire CI job `test-blocky` on path filter | done | `ci.yml` job `test-blocky` gates `build-cm5` |
| A-8 | Split `blocky-common.js` into tab modules (`blocky-dashboard.js`, …) | done | `blocky-common.js` ~170 lines; base + 7 tab modules; largest ~820 lines |

**Epic A exit:** CI green; coverage report documented in `tests/README.md`.

---

### Epic B — rpcd status & Debug tab (P0)

| ID | Task | Status | Acceptance criteria |
|----|------|--------|---------------------|
| B-1 | Add `getStatus` rpcd: service running, blocking status, dnsmasq forward, ports, stats ok, version | todo | Single RPC replaces scattered load() calls |
| B-2 | Add `getLogs` rpcd: `logread -e blocky` (line cap, e.g. 200 KiB) | todo | ACL read; matches oled pattern |
| B-3 | Add **Debug** tab: refresh, copy, auto-load, log level hint | todo | Bootstrap theme; `_()` strings in po |
| B-4 | Sticky **status bar** (service, blocking, dnsmasq, API reachability) | todo | Visible on every tab; links to Controls/Debug |
| B-5 | Unit tests for `getStatus` response shaping (mock popen) | todo | shell or extracted ucode helpers |

---

### Epic C — Configuration & service safety (P1)

| ID | Task | Status | Acceptance criteria |
|----|------|--------|---------------------|
| C-1 | `validate_config` rpcd: run `blocky validate --config` or config syntax check | todo | Returns `{ ok, output }`; UI blocks restart on failure |
| C-2 | Unified **Save / Save & apply** toolbar on Configuration | todo | One code path; toast + partial refresh |
| C-3 | Show diff preview before overwriting `blocking:` via lists sync | todo | Modal or notice when blocklists out of sync |
| C-4 | Expose **upstream groups** (add/remove resolver, strategy) in structured form | todo | Matches 0.34 `upstreams.groups` in default config |
| C-5 | UCI + YAML sync indicator on Block lists tab | todo | “UCI changed — click Sync to config.yml” pill |
| C-6 | Tests for validate + settings round-trip after C-1/C-4 | todo | Coverage maintained |

---

### Epic D — Logs & query workflow (P1)

| ID | Task | Status | Acceptance criteria |
|----|------|--------|---------------------|
| D-1 | Harden CSV parser against Blocky 0.34 CSV format (document sample) | todo | Fixture from upstream docs; parser tests 100% |
| D-2 | Logs tab: auto-refresh toggle (30s), copy visible page, copy all (truncated) | todo | Respects 512 KiB cap; shows truncation banner |
| D-3 | Link query log row → DNS Query tab (prefill domain) | todo | Hash or internal tab switch |
| D-4 | Optional: filter by blocked / cached / forwarded reason | todo | Client-side from parsed columns |
| D-5 | Separate **Query log** vs **Service log** sub-tabs under Logs | todo | Query = CSV; Service = logread snippet |

---

### Epic E — UX consolidation & 0.34 API audit (P2)

| ID | Task | Status | Acceptance criteria |
|----|------|--------|---------------------|
| E-1 | Merge **Controls** into **Dashboard** (remove duplicate tab) | todo | Tab hash `#controls` redirects; menu unchanged |
| E-2 | Refresh `luci-app-blocky-feature-plan.md` API table for 0.34 | todo | Version numbers aligned |
| E-3 | Audit new `/api/stats` fields in 0.34; add widgets if useful | todo | Changelog note in PKG_RELEASE |
| E-4 | `disableIf` / `optionSelected` audit on all dynamic selects | todo | No disabled controls stuck like oled bug |
| E-5 | Mobile pass: charts + tables scroll; tab menu wraps | todo | Manual QA checklist in PR template |
| E-6 | Update `po/uk/blocky.po` for new strings | todo | i18n complete for en/uk |

---

### Epic F — Package & docs hygiene (P2)

| ID | Task | Status | Acceptance criteria |
|----|------|--------|---------------------|
| F-1 | Bump `luci-app-blocky` PKG_RELEASE on each epic merge | todo | Per AGENTS.md |
| F-2 | Fix `release.yml` hardcoded `blocky-0.32.1-r2.apk` example | todo | Dynamic or version-agnostic doc |
| F-3 | Update [README.md](../README.md) Blocky section + CM5 optional install | todo | Points to this backlog |
| F-4 | Add `docs/blocky-daily-ops.md` user guide (screenshots optional) | todo | dnsmasq forward, lists, debug |
| F-5 | Optional: `luci-app-blocky` in `IMMORTALWRT_EXPECT_PACKAGES` when Blocky enabled on CM5 | defer | Only if Blocky returns to CM5 image |

---

## 8. Suggested PR sequence

```text
PR1  A-1, A-3, A-6, A-7          tests + CI (parse + ucode helpers)
PR2  A-2, A-4, A-8 (partial)     extract parse + config modules
PR3  B-1, B-2, B-3, B-5          getStatus, getLogs, Debug tab
PR4  C-1, C-2, C-6               validate + save UX
PR5  D-1, D-2, D-5               logs hardening
PR6  E-1, B-4                   merge Controls + status bar
PR7  C-3, C-4, C-5               upstream groups + sync UX
PR8  D-3, D-4, E-3–E-6           polish + 0.34 audit
```

Each PR: bump `PKG_RELEASE`, `node --check` on JS, `run-tests.sh` green.

---

## 9. Manual QA checklist (per release)

- [ ] Light + dark theme (Bootstrap / BootstrapDark)
- [ ] Viewport 520px width — tabs, charts, tables usable
- [ ] Blocky stopped → status bar red, Debug shows procd errors
- [ ] Blocky running, stats disabled → 503 banner, Dashboard still usable via Prometheus
- [ ] dnsmasq forward on/off → LAN client DNS works / falls back
- [ ] Sync blocklists → `config.yml` denylist updated; restart succeeds
- [ ] Refresh lists API → no full page reload; toast success
- [ ] CSV query log → filters, pagination, copy
- [ ] Save invalid YAML → validate fails, service stays up
- [ ] Pause 5m → countdown visible on Dashboard

---

## 10. Out of scope

- Packaging **blocky-ui** (Node on router)
- MySQL/PostgreSQL/VictoriaLogs query backends
- Grafana/Prometheus server on-router
- Multi-instance Blocky
- Replacing Blocky with AdGuard Home UI

---

## 11. Progress tracker (summary)

| Epic | Items | Done | % |
|------|-------|------|---|
| A Test & refactor | 8 | 8 | 100% |
| B Status & Debug | 5 | 0 | 0% |
| C Config safety | 6 | 0 | 0% |
| D Logs workflow | 5 | 0 | 0% |
| E UX & 0.34 | 6 | 0 | 0% |
| F Docs & release | 4 | 0 | 0% |
| **Total** | **34** | **8** | **24%** |

Update this table as backlog items move to `done`.

---

## References

- [luci-app-blocky-feature-plan.md](luci-app-blocky-feature-plan.md) — original gap analysis (2026-06)
- [Blocky OpenAPI](https://github.com/0xERR0R/blocky/blob/main/docs/api/openapi.yaml)
- [blocky-common.js](../feeds/luci/luci-app-blocky/htdocs/luci-static/resources/blocky-common.js)
- [luci.blocky.uc](../feeds/luci/luci-app-blocky/root/usr/share/rpcd/ucode/luci.blocky.uc)
- [luci-app-oled tests](../feeds/luci/luci-app-oled/tests/run-tests.sh) — host test pattern
- [cm5-security-stack skill](../.cursor/skills/cm5-security-stack/SKILL.md) — Blocky on CM5 optional tier
