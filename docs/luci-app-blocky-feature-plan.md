# luci-app-blocky — feature analysis & implementation plan

*Orange Pi CM5 / ImmortalWrt feed · Last updated: 2026-06-21.*

This document compares three surfaces:

| Surface | Role |
|---------|------|
| **[luci-app-blocky](../feeds/luci/luci-app-blocky/)** | LuCI app shipped in this feed (Services + Status views) |
| **[Blocky REST API](https://github.com/0xERR0R/blocky/blob/main/docs/api/openapi.yaml)** | Upstream control plane (`http://127.0.0.1:4000/api`, default) |
| **[blocky-ui](https://github.com/GabeDuarteM/blocky-ui)** | Standalone Next.js dashboard (reference UX, v1.9.x) |

Target Blocky version in feed: **v0.32.1** ([release notes](https://github.com/0xERR0R/blocky/releases/tag/v0.32.1)).

---

## Executive summary

**luci-app-blocky covers the core Blocky API** (blocking, cache flush, list refresh, DNS query test) and adds **OpenWrt-specific dnsmasq forwarding** that blocky-ui does not provide. Dashboards use **`GET /api/stats`** (24h in-memory statistics) with Prometheus `/metrics` fallback. Shared logic lives in **`blocky-common.js`**; `services/blocky.js` and `status/blocky.js` are thin wrappers.

**blocky-ui** adds a polished UX (countdown timer, cards, query-log table with filters) and optional **external log backends** (MySQL, PostgreSQL, SQLite, CSV, VictoriaLogs). On a router, shipping a separate Next.js container is impractical; the goal is to **port the useful ideas into LuCI**, not bundle blocky-ui.

### Implementation status (2026-06-21)

| Area | Status |
|------|--------|
| `statistics` + `queryLog` in default `config.yml` | **Done** — localhost ports `127.0.0.1:5353` / `127.0.0.1:4000` |
| `blocky-common.js` shared module | **Done** |
| `/api/stats` dashboard widgets | **Done** — with graceful 503 banner |
| Pause countdown (`autoEnableInSec`) | **Done** — 1s poll on Dashboard / Controls |
| UCI blocklists → `blocky-lists-sync` | **Done** |
| rpcd `luci.blocky` (`sync_lists`, `refresh_lists`, `http_request`) | **Done** — LuCI `expect: { '': {} }` |
| Structured Settings form (not raw YAML only) | **Done** — Advanced YAML still available |
| CSV query log viewer in LuCI | **Not implemented** (Phase 3) |
| Consolidate Services + Status menus | **Not implemented** (Phase 5) |

**Remaining high-value work:** optional CSV query log tab (Phase 3), menu consolidation (Phase 5), track upstream API changes.

---

## 1. Current luci-app-blocky functionality

### 1.1 Package layout

```text
feeds/luci/luci-app-blocky/
  htdocs/luci-static/resources/blocky-common.js      # shared UI, API, settings form
  htdocs/luci-static/resources/blocky-theme.css
  htdocs/luci-static/resources/view/services/blocky.js   # thin wrapper → createBlockyView()
  htdocs/luci-static/resources/view/status/blocky.js     # status mode wrapper
  root/usr/share/rpcd/ucode/luci.blocky.uc               # sync_lists, refresh_lists, http_request
  root/usr/share/rpcd/acl.d/luci-app-blocky.json
  root/usr/share/luci/menu.d/luci-app-blocky.json
  root/usr/share/luci-app-blocky/blocklist-catalog.json
```

Depends on: `blocky`, `luci-base`. Local HTTP to Blocky goes through **rpcd** → `/usr/sbin/blocky-http-api` (not browser-side fetch).

### 1.2 Services → Blocky (`services/blocky.js`)

Five tabs:

| Tab | Features |
|-----|----------|
| **Dashboard** | Overview metric cards (total queries, blocked, cache hit %, denylist entries); server status card; pause presets (5m/15m/30m/disable); operations (cache flush, list refresh); **real-time charts** from Prometheus polling (1h/24h/7d/30d windows, counter deltas) |
| **Configuration** | Structured **Settings** form (upstreams, blocking, ports, statistics, query log) + **Router DNS integration** (`blocky-dnsmasq-sync`); optional raw YAML in Advanced |
| **Controls** | Enable/disable blocking; custom pause duration; **per-group disable** (`groups=` query param); operations + init.d enable/disable/start/stop/restart |
| **Block lists** | UCI `blocklist` sections; catalog presets; **Sync to config.yml** (`blocky-lists-sync`) vs **Refresh lists** API (`blocky-lists-refresh`) |
| **DNS Query** | POST `/api/query` — domain + record type (A, AAAA, CNAME, …), shows response type / RCODE / reason |
| **Logs** | **Informational only** — detects `queryLog:` in YAML, explains LuCI does not parse logs |

**Transport:** rpcd `luci.blocky.http_request` → `blocky-http-api` → `http://127.0.0.1:4000`; `fs.exec` for init.d and `blocky-dnsmasq-sync`; `fs.read`/`fs.write` for config.

**OpenWrt-only (not in blocky-ui):**

- **`/usr/sbin/blocky-dnsmasq-sync`** — UCI `blocky.main.dnsmasq_forward`, sets `dhcp.@dnsmasq[].server=127.0.0.1#<port>`, restarts dnsmasq (BusyBox-safe, no `uci add_list` `#` bug).
- Forwarding status pill (fixed earlier: `fs.exec` vs `exec_direct` stdout handling).

### 1.3 Status → Blocky (`status/blocky.js`)

Dedicated status page when Prometheus is enabled:

- Blocking / service summary
- Overview cards (same metrics as dashboard)
- **Queries over time** (SVG, Prometheus delta sampling)
- **Top clients** and **top query types** (from Prometheus label dimensions `client`, `type`)
- List refresh button
- Row count selector (5/10/15)

**Data sources:** Primary **`GET /api/stats`** for overview cards, hourly chart, top lists; Prometheus `/metrics` as fallback when statistics disabled.

### 1.4 Default Blocky package config (`feeds/packages/blocky/files/config.yml`)

```yaml
ports:
  dns: 127.0.0.1:5353
  http: 127.0.0.1:4000
queryLog:
  type: csv
  target: /tmp/blocky-logs
statistics:
  enable: true
prometheus:
  enable: true
  path: /metrics
```

UCI `/etc/config/blocky`: `main.dnsmasq_forward`, `main.refresh_period`, `blocklist` sections (name, url, enabled, category, description).

### 1.5 ACL / security model

`luci-app-blocky.json` grants read/write to `config.yml`, UCI `blocky`, exec on init.d and `blocky-dnsmasq-sync`, and ubus `luci.blocky` methods. No Blocky API authentication (matches upstream default — API bound to localhost on router).

---

## 2. Blocky REST API (v0.32.x)

OpenAPI: [docs/api/openapi.yaml](https://github.com/0xERR0R/blocky/blob/main/docs/api/openapi.yaml)  
Base path: **`/api`** on the HTTP port (default **4000**).

### 2.1 Endpoints

| Method | Path | Purpose | Used by LuCI? |
|--------|------|---------|---------------|
| `GET` | `/blocking/status` | `{ enabled, disabledGroups?, autoEnableInSec? }` | Yes |
| `GET` | `/blocking/enable` | Enable blocking | Yes |
| `GET` | `/blocking/disable?duration=&groups=` | Temporary or group-scoped disable | Yes |
| `POST` | `/cache/flush` | Clear DNS cache | Yes |
| `POST` | `/lists/refresh` | Reload allow/deny lists | Yes |
| `POST` | `/query` | `{ query, type }` → resolution result | Yes |
| `GET` | `/stats` | Rolling **24h** in-memory statistics | Yes (primary dashboard source) |
| — | `GET /metrics` | Prometheus text exposition | Yes (LuCI only) |

### 2.2 `GET /api/stats` payload (high level)

Returns **`503`** if `statistics` disabled in config.

| Section | Content |
|---------|---------|
| `summary` | `queries`, `blocked`, `cached`, `forwarded`, `local`, `dropped`, `errors`, `avgResponseMs`, `cacheHitRate` |
| `perHour[]` | `{ hour, queries, blocked }` — UTC hourly buckets |
| `topDomains`, `topBlockedDomains`, `topClients` | `[{ name, count }]` |
| `byQueryType`, `byResponseType`, `byResponseCode` | Count maps |
| `lists` | Per-group allow/deny list entry counts |
| `cache` | `{ entries }` current cache size |

Independent of Prometheus; ideal for LuCI on a router (no extra DB).

### 2.3 Configuration knobs relevant to UI

| Config block | Enables |
|--------------|---------|
| `prometheus.enable` | `/metrics` — LuCI live polling |
| `statistics.enable` (see upstream docs) | `/api/stats` |
| `queryLog` | Persistent logs (CSV, DB, console) — blocky-ui log features |

CLI also exists (`blocky query`, etc.) — not used by LuCI today.

---

## 3. blocky-ui reference (GabeDuarteM/blocky-ui)

Stack: **Next.js**, **tRPC**, **shadcn/ui**, separate server process (Docker `:3000`).  
Demo: [blocky-ui.vercel.app](https://blocky-ui.vercel.app).

### 3.1 UI sections (home page)

| Component | Data source | Notes |
|-----------|-------------|-------|
| **Server status** | `GET /api/blocking/status` | Enabled/disabled badge; when enabled → pause presets (5m, 15m, 30m, disable); when disabled → enable button; **live countdown** from `autoEnableInSec` |
| **Operations** | `POST /api/cache/flush`, `POST /api/lists/refresh` | Same as LuCI |
| **Query tool** | `POST /api/query` | Domain + record type |
| **Statistics overview** | Prometheus + optional log provider | Cards: total queries, blocked, cache hit %, listed domains; 24h totals prefer log DB when configured |
| **Charts section** | Log provider only | Queries over time, top domains, top clients; time range + pagination |
| **Query logs** | External log provider | Searchable table, filters (client, domain, response type, QTYPE), pagination, auto-refresh 30s |

### 3.2 blocky-ui vs LuCI — API usage

| Feature | blocky-ui | luci-app-blocky |
|---------|-----------|-----------------|
| Blocking status / enable / disable | Yes | Yes |
| Group-scoped disable | Via API | Yes (Controls tab) |
| Cache flush / list refresh | Yes | Yes |
| DNS query test | Yes | Yes |
| **`GET /stats`** | **No** | **No** |
| Prometheus metrics | Yes | Yes |
| Query log browser | Yes (needs DB/CSV path) | **Explicitly not implemented** |
| Config editor | No | Raw YAML |
| dnsmasq LAN integration | No | **Yes (OpenWrt)** |
| Service init (procd) | No | Yes |

### 3.3 blocky-ui env (not applicable verbatim on OpenWrt)

`BLOCKY_API_URL`, optional `BLOCKY_REQUEST_HEADERS`, `QUERY_LOG_TYPE` + `QUERY_LOG_TARGET`, `PROMETHEUS_PATH`. LuCI equivalent: fixed localhost URL, optional future UCI for API headers if Blocky gains auth.

---

## 4. Gap matrix

| Capability | blocky-ui | LuCI today | Priority |
|------------|-----------|------------|----------|
| Blocking + pause presets | Full + countdown | Presets, no countdown | **P0** |
| Operations (cache, lists) | Yes | Yes | Done |
| DNS query tool | Yes | Yes | Done |
| Overview metric cards | Yes | Yes (Prometheus) | **P1** — add `/stats` fallback |
| Queries-over-time chart | Log DB / demo | Prometheus deltas | **P1** — use `perHour` from `/stats` |
| Top domains / clients | Log DB | Prometheus labels only | **P1** — `/stats` tops |
| Top **blocked** domains | Yes | No | **P1** |
| Query type / RCODE breakdown | Partial | Top types via Prometheus | **P2** — `/stats` maps |
| List group counts | No dedicated UI | Denylist total only | **P2** — `/stats.lists` |
| Cache entry count | No | No | **P2** — `/stats.cache.entries` |
| Query log search/table | Full | Stub notice | **P3** (CSV on router) |
| Config forms | N/A | Raw YAML only | **P3** |
| dnsmasq forward LAN DNS | N/A | Yes | **Keep — differentiator** |
| No full page reload on actions | Yes (toasts) | Often `location.reload()` | **P0** |
| Single combined app entry | N/A | Split Services + Status | **P2** — UX cleanup |
| API auth headers | Env var | N/A | **P4** |
| Blocky v0.32 `/stats` + DNSSEC fixes | N/A | Needs `statistics` in config | **P0** |

---

## 5. Recommended implementation plan

### Phase 0 — Foundation (1–2 PRs) — **largely complete**

**Goal:** Correct data sources for v0.32.1; less jarring UX.

| Task | Status |
|------|--------|
| Enable **`statistics`** in default `config.yml` | Done |
| Add **`/api/stats`** helper + graceful 503 handling | Done |
| **Pause countdown** on Dashboard / Controls | Done |
| **Stop full reload** after operations | Done (notifications + partial refresh) |
| Shared **`blocky-common.js`** module | Done |

**Acceptance:** With default config, `/stats` returns JSON; pause timer visible; cache flush does not reload entire LuCI page.

---

### Phase 1 — Native statistics dashboard (2–3 PRs) — **largely complete**

**Goal:** Match blocky-ui overview + charts using `/api/stats`, reduce reliance on Prometheus label hacks.

| Task | Status |
|------|--------|
| **Overview cards** from `summary.*` + denylist counts | Done |
| **Queries over time** from `perHour[]` | Done |
| **Top lists** (`topClients`, `topDomains`, `topBlockedDomains`) | Done |
| Poll `/stats` on Dashboard/Status | Done |
| Status page shares `blocky-common.js` | Done |

---

### Phase 2 — Detail panels (1–2 PRs)

| Task | Details |
|------|---------|
| **Response breakdown** | Bar chart from `byResponseType` / `byQueryType` / `byResponseCode` |
| **List inventory** | Table of `lists.denylist` / `lists.allowlist` per group |
| **Cache widget** | Show `cache.entries` + link to flush |
| **Avg response time** | Display `summary.avgResponseMs` |

---

### Phase 3 — Query logs on-router (optional, larger)

blocky-ui expects a **sidecar database or log directory**. On OpenWrt:

| Approach | Pros | Cons |
|----------|------|------|
| **`queryLog.type: csv`** to `/tmp/blocky-logs/` | Simple, no SQL | tmpfs size, lost on reboot, single-day bias (same as blocky-ui CSV note) |
| **SQLite on overlay** | Structured queries | Requires `sqlite3` CLI or LuCI RPC parser; flash wear |
| **External syslog** | No LuCI parser | User leaves LuCI |

**Recommended MVP:** If `queryLog.type: csv` in config, add read-only LuCI tab:

- Tail / parse today’s CSV via `fs.read` (size cap, e.g. 512 KB)
- Filters: domain substring, client IP, response type (client-side)
- Pagination (50 rows)
- No write path; document flash/tmpfs limits

**Defer:** MySQL/PostgreSQL/VictoriaLogs (blocky-ui backends) — unrealistic on typical CM5 image.

---

### Phase 4 — Configuration UX (optional)

| Task | Details |
|------|---------|
| **UCI → YAML** for common fields | Upstreams, blocking groups, ports, prometheus/statistics toggles |
| Keep **Advanced → full YAML** | Power users |
| Validate YAML before restart | Optional `blocky validate` if upstream CLI supports it |

blocky-ui intentionally avoids config editing; LuCI can exceed blocky-ui here for router admins.

---

### Phase 5 — Polish & maintenance

| Task | Details |
|------|---------|
| Consolidate **Services + Status** into one menu entry with sub-tabs | Reduce user confusion (“Charts are here; top lists are there”) |
| **Dark mode** audit | CSS already has `data-darkmode` rules — verify with ImmortalWrt theme |
| **ACL tightening** | If query logs added, scope read path to log directory only |
| **Version display** | Parse Blocky version from metrics or `blocky version` for support |
| Track blocky-ui / Blocky API changes | OpenAPI in upstream repo is source of truth |

---

## 6. OpenWrt / CM5 constraints

| Constraint | Impact |
|------------|--------|
| **No Node.js on router** | Cannot ship blocky-ui binary; port patterns only |
| **`uclient-fetch`** | All API calls; no WebSocket; keep payloads small |
| **LuCI JS (ES5-style)** | No React; manual DOM (`E()`), `poll.add` for refresh |
| **Memory / flash** | Avoid large log indexing; cap CSV reads |
| **localhost API** | Sufficient for admin UI; no CORS issues |
| **procd** | Service control via `/etc/init.d/blocky` remains correct |

---

## 7. Suggested file changes (when implementing)

| File | Change |
|------|--------|
| `feeds/packages/blocky/files/config.yml` | `statistics`, `queryLog`, localhost ports — **done** |
| `feeds/luci/luci-app-blocky/htdocs/.../blocky-common.js` | Shared API, stats renderers — **done** |
| `root/usr/share/rpcd/ucode/luci.blocky.uc` | rpcd bridge for localhost HTTP — **done** |
| `services/blocky.js` / `status/blocky.js` | Thin wrappers — **done** |
| `PKG_RELEASE` | Bump on each LuCI/blocky recipe change |

---

## 8. Out of scope (for this feed)

- Packaging **blocky-ui** as an OpenWrt package (heavy Node runtime).
- Grafana/Prometheus server on router (LuCI only **scrapes** Blocky’s embedded metrics).
- Replacing Blocky with AdGuard / Pi-hole UI patterns.
- Multi-instance Blocky (blocky-ui `INSTANCE_NAME`).

---

## References

- [0xERR0R/blocky](https://github.com/0xERR0R/blocky) — DNS proxy ([v0.32.1](https://github.com/0xERR0R/blocky/releases/tag/v0.32.1))
- [Blocky OpenAPI](https://github.com/0xERR0R/blocky/blob/main/docs/api/openapi.yaml)
- [Blocky documentation](https://0xERR0R.github.io/blocky/)
- [GabeDuarteM/blocky-ui](https://github.com/GabeDuarteM/blocky-ui) — reference dashboard ([README](https://github.com/GabeDuarteM/blocky-ui/blob/main/README.md))
- [luci-app-blocky services view](../feeds/luci/luci-app-blocky/htdocs/luci-static/resources/view/services/blocky.js)
- [luci-app-blocky status view](../feeds/luci/luci-app-blocky/htdocs/luci-static/resources/view/status/blocky.js)
- [blocky-dnsmasq-sync](../feeds/packages/blocky/files/usr/sbin/blocky-dnsmasq-sync) — OpenWrt DNS integration
