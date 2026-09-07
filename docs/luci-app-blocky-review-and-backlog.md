# luci-app-blocky — review, API contracts, security & backlog

**Date:** 2026-09-07  
**Scope:** `feeds/luci/luci-app-blocky/` + host helpers in `feeds/packages/blocky/` that the LuCI app calls  
**Versions:** Blocky **v0.35.0** (`PKG_RELEASE` 1) · `luci-app-blocky` **PKG_RELEASE 79**  
**Supersedes:** the 2026-08-28 “34/34 complete” claim in this file. Historical API notes remain in [luci-app-blocky-feature-plan.md](luci-app-blocky-feature-plan.md).

This is the **active** plan. Do not treat Epic A–F from August as done: several P0 defects shipped after that tracker was closed, and unit tests never covered them.

---

## Executive summary

The app is a real OpenWrt 25.x LuCI surface (JS views, ucode rpcd, footer Save & Apply, scoped Bootstrap CSS). It is **not** yet a well-contracted, well-tested LuCI app.

Three live defects from 2026-09-07 prove the gap:

| Symptom | Root cause | Tests |
|---------|------------|--------|
| “No Prometheus samples” while Settings shows Prometheus on | `luci.blocky http_request` threw on `upper()` / `String()` (not ucode builtins); LuCI always sends `body: ""` | None until a source grep was added after the bug |
| Query tab “Request to Blocky failed” | `blocky-http-api` POST used `uclient-fetch` wget post-type flag (unsupported on this image) | **Fixed (G-2):** `--header=Content-Type: application/json`; host grep |
| Uncheck list → YAML confirm / rewrite | Grid called `applyBlocklistChanges` (uci.save + lists-sync + restart) instead of staging until footer Save & Apply | Grid staging-only (PKG 67+). **lists-sync no longer re-injects defaults if UCI has zero enabled lists (G-4)** |
| Block lists Save & Apply → `XHR request timed out` | `getStatus` called `/etc/init.d/blocky enabled` from inside rpcd, which deadlocks ubus until the 30s limit. After restart it also waited on `/metrics`/`/api/stats` while lists load. | **Fixed (I-6):** boot-enabled = `/etc/rc.d/S*blocky` symlink; GET hard-kill 3s; `getStatus` only probes blocking/status; footer does not await the post-apply refresh |

**100% unit coverage is not true today.** Host tests are ~53 Node cases + 2 thin shell scripts. They cover extractable parse/config helpers and a few source-string UI checks. They do **not** execute `luci.blocky.uc`, tab modules, `blocky-base.js` RPC wrappers, `blocky-lists-sync`, or POST `/api/query`.

---

## 1. Current architecture

### 1.1 Layout (today)

```text
feeds/luci/luci-app-blocky/
  htdocs/luci-static/resources/
    view/services/blocky.js     # thin → createBlockyView()
    view/status/blocky.js       # bookmark redirect → #status
    blocky-common.js            # tabs, hero, footer save (~235 lines)
    blocky-base.js              # RPC, apply, metrics poll (~1044)
    blocky-parse-core.js        # metrics/stats/CSV/ports (~1118) — best tested
    blocky-config-core.js       # YAML ↔ settings (~449)
    blocky-tab-*.js             # status/stats/lists/settings/query/logs (+ dead debug)
    blocky-theme.css            # ~1700 lines, scoped .luci-app-blocky
  root/usr/share/rpcd/ucode/luci.blocky.uc
  root/usr/share/rpcd/acl.d/luci-app-blocky.json
  root/usr/share/luci/menu.d/luci-app-blocky.json
  root/usr/share/luci-app-blocky/blocklist-catalog.json
  po/en/blocky.po, po/uk/blocky.po
  tests/                        # run-tests.sh; CI job test-blocky
  scripts/split-blocky-common.js  # regenerates tab alias dumps — maintenance hazard

feeds/packages/blocky/files/usr/sbin/
  blocky-http-api, blocky-lists-sync, blocky-lists-refresh,
  blocky-dnsmasq-sync, blocky-config-apply, blocky-boot
```

Approximate LuCI JS+CSS+ucode: **~10k lines**.

### 1.2 Tabs (mounted)

| Hash | Title | Role |
|------|--------|------|
| `#status` | Status | Service glance, blocking pause, live Prometheus charts |
| `#statistics` | Statistics | `/api/stats` 24h + operations (refresh lists, flush) |
| `#blocklists` | Block lists | UCI grid; stage until Save & Apply (as of PKG 67+) |
| `#settings` | Settings | Structured YAML form + advanced YAML; **owns footer apply handler** |
| `#query` | Query | POST `/api/query` |
| `#logs` | Logs | Query CSV + service `logread` inner tabs |

`blocky-tab-debug.js` is **not** required by `blocky-common.js` (UI test forbids it). Service logs live under Logs. The debug module is dead weight unless re-homed.

### 1.3 Data paths

```text
Browser LuCI JS
  → rpc.declare luci.blocky.*          (expect: { '': {} })
      → /usr/sbin/blocky-http-api      → 127.0.0.1:4000 /api|/metrics
      → /usr/sbin/blocky-lists-sync    → rewrite blocking: in config.yml
      → /usr/sbin/blocky-lists-refresh → POST /api/lists/refresh
      → /usr/sbin/blocky-dnsmasq-sync
      → blocky validate --config
      → logread -e blocky
  → uci package blocky                 (blocklist sections, main.enabled)
  → fs read/write /etc/blocky/config.yml
  → /etc/init.d/blocky restart
```

Footer **Save** / **Save & Apply** → `runSettingsApply` → `saveBlockySettingsForm` → `applyBlockyConfigYaml` (validate, write YAML, `uci.save`, `execBlockyListsSync`, optional restart).

---

## 2. Strengths (keep)

| Area | Notes |
|------|--------|
| OpenWrt 25.x stack | ucode rpcd, JS views, no `/usr/libexec/rpcd` shell plugin |
| Localhost HTTP | Browser never fetches `:4000`; ACL requires `blocky-http-api` |
| Footer Save & Apply | Matches LuCI convention; Settings form is the apply handler |
| Dual metrics | `/api/stats` (24h) + Prometheus deltas while the page is open |
| Catalog + UCI lists | Presets in `blocklist-catalog.json`; IDs sanitized |
| Query log allowlist | `/tmp/blocky-logs` only |
| Theming | Scoped root, dark-mode selectors, CSS variables (accents still hex — see P2) |
| i18n | `_()` + `po/en` + `po/uk` |
| CI | `test-blocky` gates the SDK job |

---

## 3. Findings (2026-09-07)

### P0 — correctness / security

| ID | Finding | Impact |
|----|---------|--------|
| **P0-1** | `luci.blocky.uc` used JS-isms `upper()` and `String()`. rpcd-mod-ucode has `uc()` only; `String` is not a function. LuCI `http_request` always passes `body: ""`, so **every metrics/query RPC threw** (“Unknown error”). Partial fix in tree: `uc()` + `as_str()` / `sprintf`. | Dashboard Prometheus banner; Query; any POST |
| **P0-2** | `blocky-http-api` `blocky_http_post_json` used wget post-type. This image’s `uclient-fetch` rejects it. **Fixed:** both clients use `--header`. | Query tab |
| **P0-3** | ACL **read** granted `http_request`, `sync_lists`, `refresh_lists`, `validate_config`, and `exec` of `/etc/init.d/blocky` and `blocky-dnsmasq-sync`. **Fixed (G-3):** those are write-only; read is getStatus/getLogs/read_query_log/get_version. | Privilege split |
| **P0-4** | `blocky-lists-sync`: if **zero enabled** UCI lists, it injected hagezi_light + urlhaus. **Fixed:** empty UCI ⇒ `denylists: {}` + `default: []`. | Empty denylist |
| **P0-5** | Tests did not execute ucode or POST HTTP. P0-1/P0-2 shipped as “green CI”. Host greps now cover ucode `String`/`upper`, `--post-type`, empty denylist, ACL read list. `ucode -c` runs when the binary exists. | Coverage |
| **P0-6** | Footer Save & Apply restarted Blocky then awaited `getStatus`. That method ran `/etc/init.d/blocky enabled` inside rpcd (ubus deadlock until 30s) and scraped `/metrics`/`/api/stats` while lists load. **Fixed (I-6).** | Block lists / Settings Save & Apply |

### P1 — contracts, UX, maintainability

| ID | Finding | Impact |
|----|---------|--------|
| **P1-1** | Prometheus empty-state copy blamed config even when YAML `enable: true`. **Fixed (H-2):** RPC error vs waiting-for-samples. | Ops copy |
| **P1-2** | `http_request` is a **generic proxy** (method + path + body). Path regex is loose (`api/blocking/disable` is legal). Prefer named RPCs (`queryDns`, `getMetrics`, `setBlocking`, …). | Contract + ACL hard to reason about |
| **P1-3** | Every `blocky-tab-*.js` starts with ~90 unused `Blocky.*` aliases from `split-blocky-common.js`. `blocky-tab-debug.js` unused. | Review noise, load cost |
| **P1-4** | `MAX_HTTP_UBUS_OUT = 16384` silently truncates `/metrics` (live dump already ~13.6 KiB and growing). Truncation can drop counters; no `truncated` flag. | Charts lie under load |
| **P1-5** | `popen(\`${cmd} 2>&1\`)` mixes stderr into “stdout”. Failed GET still parsed as metrics/JSON. | Fragile RPC `ok` |
| **P1-6** | `getStatus` does not include metrics text; page does a second `http_request`. `loadBlockyPageData` races `fetchText(metrics)` in `Promise.all` before `applyBlockyApiAccess`. | Extra failure modes |
| **P1-7** | `handleReset: null` — staged UCI (blocklist checkboxes) cannot revert from the footer. Reload is the only undo. | LuCI convention |
| **P1-8** | Settings apply writes **full YAML from form snapshot** then lists-sync. Advanced YAML vs structured fields vs UCI lists can still desync `blocking:`. | Operator surprise |
| **P1-9** | Statistics “Refresh lists” YAML-synced then API-refreshed. **Fixed (I-2):** API refresh only. `confirmBlocklistsYamlSync` still exists for leftover `applyBlocklistChanges` (unused by the grid). | Same class as Sep 7 UX bug |
| **P1-10** | Query/log filter placeholders `example.org` / `192.168.1.10` were not wrapped in `_()`. **Fixed (K-2).** | i18n |

### P2 — polish / guidelines

| ID | Finding |
|----|---------|
| **P2-1** | Chart/modal accents use raw hex (`#2196f3`, `#fff` on pills). Skill wants Bootstrap tokens + tone classes. |
| **P2-2** | No `c8` / coverage gate; `tests/README.md` still says Epic A 100% on cores only. |
| **P2-3** | Docs claimed backlog complete (PKG 49). This file was stale. |
| **P2-4** | `parseMetrics` drops OpenMetrics timestamps (`value timestamp` on the line). Golden fixture has no timestamps. |
| **P2-5** | Sticky status bar from Epic B was replaced by a hero; Debug tab merged into Logs but the orphan JS file remains. |

---

## 4. API contracts

### 4.1 Blocky HTTP (upstream 0.35)

Bind: **`127.0.0.1:4000` only** (keep). Do not expose `:4000` on LAN.

| Upstream | LuCI use | Contract notes |
|----------|----------|----------------|
| `GET /metrics` | Live charts, denylist gauges, version | Prometheus text; may exceed 16 KiB |
| `GET /api/stats` | Statistics tab | 503 if `statistics.enable: false` |
| `GET /api/blocking/status` | Pause countdown | `{ enabled, autoEnableInSec }` |
| `POST /api/blocking/enable` / `disable` | Status controls | Body duration for pause |
| `POST /api/cache/flush` | Statistics operations | Empty POST |
| `POST /api/lists/refresh` | Update lists now / Refresh lists | Must not imply UCI→YAML sync |
| `POST /api/query` | Query tab | JSON `{ query, type }`; **broken on uclient-fetch today** |

**Target LuCI RPC (named, not a proxy):**

```text
getStatus          # already: service, blocking, dnsmasq, stats_json, ports
getMetrics         # GET /metrics; truncated:bool; max_bytes
getQueryLog        # read_query_log (keep allowlist)
getLogs            # logread (keep caps)
queryDns           # POST /api/query only
setBlocking        # enable|disable + optional duration
flushCache         # POST /api/cache/flush
refreshLists       # POST /api/lists/refresh  (running process only)
syncLists          # UCI → YAML  (write ACL only; no default-list injection)
validateConfig     # blocky validate (write ACL)
applyConfig        # validate + write yaml + optional restart (write)
```

Deprecate **`http_request`** after the named methods exist. Until then, restrict path to an allowlist enum (`metrics`, `api/stats`, `api/blocking/status`, `api/query`, …) and **GET-only on read ACL**.

### 4.2 UCI (`blocky`)

| Section | Role |
|---------|------|
| `main` | `enabled`, `refresh_period`, `dnsmasq_forward` |
| `blocklist` | `name`, `url`, `enabled`, `category`, `description` |

**Rule:** LuCI grid **only `uci.set` / `uci.add` / `uci.remove`**. Persist + YAML rewrite **only** on footer Save / Save & Apply. Never `uci.save` + lists-sync on checkbox change.

### 4.3 YAML (`/etc/blocky/config.yml`)

Single writer per apply:

1. `blocky validate --config` on a temp file  
2. Write `/etc/blocky/config.yml`  
3. `blocky-lists-sync` **without** resurrecting disabled/empty UCI  
4. Restart only on Save & Apply  

Empty enabled UCI lists ⇒ empty `denylists:` + empty `clientGroupsBlock.default` (or a documented “blocking off” sentinel) — **not** a silent restore of package defaults.

### 4.4 ucode runtime contract (OpenWrt 25.x)

Never use in `luci.*.uc`:

- JS globals: `String`, `Number`, `Boolean`, `upper`, `toUpperCase`
- `{` `}` inside regex literals or `` `${...}` `` templates (interpolation)
- Helpers **below** their first caller (`'use strict'` does not hoist)

Use: `uc()`, `sprintf('%s', v)`, `int()`, `chr(123)` / `chr(125)` for braces in strings.

CI must **`ucode -c`** this file (router job or a checked-in fixture runner). Source greps for `String(` / `upper(` are the minimum host gate.

---

## 5. Security guidelines

| Rule | Today | Target |
|------|--------|--------|
| Least privilege ACL | Mutating ubus + init exec on **read** | Read: `getStatus`, `getMetrics`, `getLogs`, `getQueryLog`, `queryDns` (optional), `validateConfig` dry-run without write. Write: sync, apply, refresh, setBlocking, flush, init exec |
| No generic HTTP proxy | `http_request` | Named methods + path enum |
| Command injection | `shellquote` on `popen` argv | Keep quoting; prefer `fs.popen` with argv array if available; never interpolate user YAML into the shell command line |
| YAML write | Temp file + `blocky validate` | Keep; do not exec `blocky` with user path except the temp/allowlisted config |
| Query logs | Dir allowlist | Keep `/tmp/blocky-logs` |
| Listeners | Localhost in settings form | Reject Save if DNS/HTTP not loopback |
| CSRF / session | LuCI session + ACL | Unchanged; do not add extra cookies |
| Secrets | No Blocky API key (0.34) | Do not invent basic-auth fields that 0.34 ignores |
| Metrics size | Silent truncate | Cap + `truncated`; or strip `go_*` / `process_*` before ubus |

---

## 6. LuCI / feed guidelines gap

Reference: skills **openwrt-25x**, **luci-bootstrap-theming**, **openwrt-feed-packages**, **rpcd-ucode-strict**; peers `luci-app-suricata`, `luci-app-snort3`.

| Guideline | Gap |
|-----------|-----|
| Footer Save & Apply only | Lists grid (67+); Statistics “Refresh lists” is API-only (PKG 70) |
| No in-page duplicate save | OK on Settings |
| `_()` all strings | Query/log placeholders wrapped (PKG 70) |
| `rpc.declare` `expect: { '': {} }` | OK |
| ucode helpers above callers | OK structurally; builtins were wrong |
| Bootstrap tokens | Hex leftovers in theme + `BLOCKY_CHART_FALLBACK` in JS |
| No board prose | OK (tests assert no CM5 copy) |
| `PKG_RELEASE` bump | Follow per PR |
| apk not opkg | OK |

**Target UX (daily, no SSH):**

1. Status: running / paused / dnsmasq — honest metrics (or “metrics RPC failed”, not “enable Prometheus”).  
2. Block lists: edit freely; **Save & Apply** writes YAML; empty selection stays empty.  
3. Query: JSON POST works.  
4. Logs: CSV + syslog.  
5. Settings: validate then apply; loopback enforced.

---

## 7. Testing — 100% of *testable* code

LuCI `E()` / `poll` / live ubus cannot be 100% in Node. **Claim 100% only for:**

1. `blocky-parse-core.js` (every exported function)  
2. `blocky-config-core.js` (every exported function)  
3. `luci.blocky.uc` helpers extracted or mirrored **and** `ucode -c`  
4. `blocky-http-api`, `blocky-lists-sync`, `blocky-dnsmasq-sync` (shell + fixtures)  
5. UI **invariants** (source tests): footer apply, no `applyBlocklistChanges` on checkbox, no `--post-type`, no `String(` / `upper(` in ucode  

### 7.1 Current counts (2026-09-07)

| File | Tests | What they actually do |
|------|------|------------------------|
| `blocky-parse.test.mjs` | 23 | Happy-path parsers + golden metrics/CSV |
| `blocky-config.test.mjs` | 9 | YAML round-trip on fixture |
| `luci-blocky-validation.test.mjs` | 5 | JS mirror of path rules + ucode grep |
| `blocky-ui.test.mjs` | 7 | Regex on JS/CSS source |
| `blocky-status.test.mjs` | 4 | Status shaping |
| `blocky-sync.test.mjs` | 5 | Denylist fingerprints |
| `test-blocky-http-api.sh` | 2 asserts | Port parse only |
| `test-blocky-dnsmasq-sync.sh` | format | Upstream `#port` |

**Untested (mandatory for the 100% claim):**

| Module | Missing |
|--------|---------|
| parse-core | `unwrapFsRead`, `parseBlockyDnsPort`, `parseJson`, `sumMapValues`, `sumDenylistEntries`, `formatCompactNumber`, `isValidQueryLogFilename`, OpenMetrics timestamps, empty/truncated metrics |
| config-core | malformed YAML, prometheus default vs explicit `false`, empty upstream group |
| `luci.blocky.uc` | `as_str`, empty body, `uc()`, `ucode -c` in CI, injection paths (`../`, `{`, `;`) |
| `blocky-http-api` | GET/POST routing, **forbid `--post-type`**, header Content-Type, failure exit codes |
| `blocky-lists-sync` | enabled/disabled UCI, **zero lists must not restore defaults**, YAML quote escaping |
| `blocky-base.js` | `blockyRpcOk`, `unwrapFetchText`, `blockyPathFromUrl` via real wrappers |
| tabs | no logic tests (sanitize id, stage vs save) |

### 7.2 Tooling

```text
c8 --check-coverage --lines 100 --functions 100 \
  node tests/blocky-parse.test.mjs
  node tests/blocky-config.test.mjs
```

Add `tests/blocky-http-api.test.sh` (grep `--post-type` must fail), `tests/blocky-lists-sync.test.sh`, `tests/luci.blocky.ucode.test.sh` (`ucode -c` when binary exists; otherwise skip with explicit SKIP).

CI: keep `test-blocky`; add coverage job on parse+config cores; fail if `--post-type` or `\bString\s*\(` appears in ucode/http-api.

---

## 8. Target design (proper LuCI app)

```text
view/services/blocky.js     thin
blocky-common.js            tabs + footer only
blocky-rpc.js               named rpc.declare only (new extract)
blocky-parse-core.js        pure (tested)
blocky-config-core.js       pure (tested)
blocky-tab-{status,stats,blocklists,settings,query,logs}.js
                            no 90-line alias dumps; require what you use
luci.blocky.uc              named methods; as_str; try/catch → { ok, error }
```

Delete or stop generating: `scripts/split-blocky-common.js` alias blast, `blocky-tab-debug.js` (or require it only if Logs is split).

---

## 9. Backlog

**Status:** `todo` · `doing` · `done`  
**Priority:** P0 blocker · P1 daily · P2 polish

### Epic G — Stop the bleeding (P0)

| ID | Task | Status | Acceptance |
|----|------|--------|------------|
| G-1 | ucode: no `String`/`upper`; `as_str` + `uc`; empty `body` safe | done | `ubus call luci.blocky http_request '{"method":"GET","path":"metrics","body":""}'` → `ok:true`; `ucode -c` |
| G-2 | `blocky-http-api`: `--header=Content-Type: application/json`; never wget post-type | done | Query `2ip.ua` A succeeds on router; host test greps script |
| G-3 | ACL: mutating methods + init exec **write-only** | done | JSON review + test asserting read list (named GET `getMetrics` still H-1) |
| G-4 | `blocky-lists-sync`: empty enabled UCI ⇒ empty denylist (no default resurrection) | done | Fixture with all `enabled=0` |
| G-5 | Host tests for G-1–G-4 so CI fails if they regress | done | `run-tests.sh` red on revert |

### Epic H — Named RPC & metrics honesty (P1)

| ID | Task | Status | Acceptance |
|----|------|--------|------------|
| H-1 | `getMetrics` with `truncated`; prefer Blocky counters, drop `go_*` if over cap | done | Banner gone when `/metrics` works; truncated note if clipped |
| H-2 | Replace dashboard copy: RPC fail vs waiting-for-samples | done | String test |
| H-3 | Named `queryDns` / `setBlocking` / `flushCache` / `refreshLists`; retire UI use of `http_request` | done | ACL + JS Query uses `queryDns` |
| H-4 | `getStatus` optionally embeds a short metrics digest to avoid a second RPC | done (reverted) | Embedding `/metrics` made Save & Apply exceed rpcd’s 30s timeout after restart. First paint uses `getMetrics` in parallel instead. |
| H-5 | Separate stderr in `run_bin` (no `2>&1` into stdout) | done | `2>/dev/null`; failed GET is not parsed as Prom |

### Epic I — LuCI apply model (P1)

| ID | Task | Status | Acceptance |
|----|------|--------|------------|
| I-1 | Grid stays staging-only (already started PKG 67) | done | No confirm on uncheck |
| I-2 | Statistics “Refresh lists” = API refresh only (no YAML sync) | done | Same as “Update lists now” |
| I-3 | Footer Reset restores UCI + form (or document why not) | done | `handleReset` → `uci.revert('blocky')` + refresh |
| I-4 | After Save & Apply, refresh lists tab from committed UCI | done | Checkbox matches disk |
| I-5 | Single apply pipeline documented in `tests/README.md` | todo | Diagram matches code |
| I-6 | Save & Apply must not wait on hung Blocky `/metrics` or `/api/stats` | done | After restart, `ubus -t 8 call luci.blocky getStatus` returns in well under 1s; LuCI Save & Apply on Block lists succeeds |

### Epic J — 100% testable coverage (P1)

| ID | Task | Status | Acceptance |
|----|------|--------|------------|
| J-1 | c8 100% lines/functions on parse-core + config-core | todo | CI flag |
| J-2 | Fill parse-core holes (timestamps, empty metrics, catalog edge) | todo | c8 green |
| J-3 | Shell: lists-sync + http-api routing + POST header | done | Fixtures (full GET/POST routing still thin) |
| J-4 | `ucode -c luci.blocky.uc` in `run-tests.sh` when `ucode` exists | done | Local skip documented |
| J-5 | Forbid wget post-type, `String(`, `upper(` in CI grep | done | test-blocky |
| J-6 | Trim tab modules: drop unused aliases; delete or wire debug JS | todo | line count drop |

### Epic K — Guidelines polish (P2)

| ID | Task | Status | Acceptance |
|----|------|--------|------------|
| K-1 | Theme: tokens / tone classes; remove stray `#fff` | todo | dark/light QA |
| K-2 | `_()` on remaining placeholders | done | po update |
| K-3 | `parseMetrics` OpenMetrics timestamp | todo | fixture |
| K-4 | Keep this backlog honest (no “100% done” without evidence) | todo | update on each epic merge |
| K-5 | PKG_RELEASE bump per merge | todo | AGENTS.md |

---

## 10. Suggested PR sequence

```text
PR1–5  G-1–G-5, I-1, I-2, H-2, J-3–J-5, K-2   PKG 70 / blocky 25 (this batch)
PR6    H-1, H-3                   named RPC + getMetrics on read ACL
PR7    J-1, J-2                   coverage gate
PR8    J-6, remaining K-*         hygiene
```

Each PR: `PKG_RELEASE++`, `./feeds/luci/luci-app-blocky/tests/run-tests.sh`, `ucode -c` on router before live deploy.

---

## 11. Manual QA (per release)

- [ ] Light + dark, 520px width  
- [ ] Blocky stopped → hero not running; Query/metrics fail with a **specific** error  
- [ ] Prometheus on → Status charts after ≤20s; **no** “enable prometheus” banner  
- [ ] Uncheck all lists → **no** dialog; Save & Apply → `config.yml` denylist empty (or documented sentinel), **not** hagezi+urlhaus  
- [ ] Query `2ip.ua` A → NOERROR JSON  
- [ ] Save invalid YAML → validate fails, service stays up  
- [ ] Pause 5m → countdown on Status  
- [ ] Read-only LuCI user (if present) cannot restart Blocky or sync lists  

---

## 12. Out of scope

- Shipping blocky-ui (Next.js) on the router  
- Grafana / remote Prometheus  
- MySQL/VictoriaLogs query backends  
- Changing Blocky upstream version in the same PR as LuCI refactors  

---

## References

- [luci-app-blocky-feature-plan.md](luci-app-blocky-feature-plan.md) — 0.34 API history  
- [blocky-daily-ops.md](blocky-daily-ops.md)  
- [Blocky OpenAPI v0.35](https://github.com/0xERR0R/blocky/blob/v0.35.0/docs/api/openapi.yaml)  
- Skills: `openwrt-25x`, `luci-bootstrap-theming`, `openwrt-feed-packages`, `rpcd-ucode-strict`  
- Peers: `luci-app-suricata`, `luci-app-snort3` (named RPC, ACL split, footer apply)  
