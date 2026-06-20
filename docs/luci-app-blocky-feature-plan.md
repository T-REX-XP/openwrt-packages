# luci-app-blocky — feature analysis & implementation plan

*Orange Pi CM5 / ImmortalWrt feed · Last updated: 2026-06-20.*

This document compares three surfaces:

| Surface | Role |
|---------|------|
| **[luci-app-blocky](../feeds/luci/luci-app-blocky/)** | LuCI app shipped in this feed (Services + Status views) |
| **[Blocky REST API](https://github.com/0xERR0R/blocky/blob/main/docs/api/openapi.yaml)** | Upstream control plane (`http://127.0.0.1:4000/api`, default) |
| **[blocky-ui](https://github.com/GabeDuarteM/blocky-ui)** | Standalone Next.js dashboard (reference UX, v1.9.x) |

Target Blocky version in feed: **v0.32.1** ([release notes](https://github.com/0xERR0R/blocky/releases/tag/v0.32.1)).

---

## Executive summary

**luci-app-blocky already covers the core Blocky API** (blocking, cache flush, list refresh, DNS query test) and adds **OpenWrt-specific dnsmasq forwarding** that blocky-ui does not provide. Dashboards are built from **Prometheus `/metrics` counter deltas** while the page is open — workable, but fragile compared to Blocky’s native **`GET /api/stats`** (rolling 24h in-memory statistics, Blocky ≥ recent versions).

**blocky-ui** adds a polished UX (countdown timer, cards, query-log table with filters) and optional **external log backends** (MySQL, PostgreSQL, SQLite, CSV, VictoriaLogs). On a router, shipping a separate Next.js container is impractical; the goal is to **port the useful ideas into LuCI**, not bundle blocky-ui.

**Highest-value next steps:**

1. Wire **`GET /api/stats`** and enable **`statistics`** in default `config.yml`.
2. Replace Prometheus-only top lists / charts where `/stats` is clearer (`perHour`, `topClients`, `topDomains`, `topBlockedDomains`).
3. Improve blocking UX (live countdown, fewer full page reloads).
4. Optional **CSV query log viewer** (read-only, tmpfs path) — only if `queryLog` is enabled in YAML.

---

## 1. Current luci-app-blocky functionality

### 1.1 Package layout

```text
feeds/luci/luci-app-blocky/
  htdocs/luci-static/resources/view/services/blocky.js   # main app (tabs)
  htdocs/luci-static/resources/view/status/blocky.js     # status / charts
  root/usr/share/luci/menu.d/luci-app-blocky.json
  root/usr/share/rpcd/acl.d/luci-app-blocky.json
```

Depends on: `blocky`, `luci-base`, `uclient-fetch` (local HTTP to Blocky on `:4000`).

### 1.2 Services → Blocky (`services/blocky.js`)

Five tabs:

| Tab | Features |
|-----|----------|
| **Dashboard** | Overview metric cards (total queries, blocked, cache hit %, denylist entries); server status card; pause presets (5m/15m/30m/disable); operations (cache flush, list refresh); **real-time charts** from Prometheus polling (1h/24h/7d/30d windows, counter deltas) |
| **Configuration** | **Router DNS integration** — `blocky-dnsmasq-sync` enable/disable dnsmasq → Blocky upstream; raw **`/etc/blocky/config.yml`** textarea (save / save & restart) |
| **Controls** | Enable/disable blocking; custom pause duration; **per-group disable** (`groups=` query param); operations + init.d enable/disable/start/stop/restart |
| **DNS Query** | POST `/api/query` — domain + record type (A, AAAA, CNAME, …), shows response type / RCODE / reason |
| **Logs** | **Informational only** — detects `queryLog:` in YAML, explains LuCI does not parse logs |

**Transport:** `uclient-fetch` to `http://127.0.0.1:4000/api/*` and `/metrics`; `fs.exec` for init.d and `blocky-dnsmasq-sync`; `fs.read`/`fs.write` for config.

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

**Limitation:** Rankings depend on Prometheus exposing labeled counters; no use of **`GET /api/stats`**.

### 1.4 Default Blocky package config (`feeds/packages/blocky/files/config.yml`)

```yaml
ports:
  dns: 5353
  http: 4000
prometheus:
  enable: true
  path: /metrics
```

**Missing for full API stats:** no `statistics:` section (required for `/api/stats`). No `queryLog:` (expected on router).

### 1.5 ACL / security model

`luci-app-blocky.json` grants read/write to `config.yml`, exec on init.d, dnsmasq-sync, and `uclient-fetch`. No Blocky API authentication (matches upstream default — API bound to localhost on router).

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
| `GET` | `/stats` | Rolling **24h** in-memory statistics | **No** |
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

### Phase 0 — Foundation (1–2 PRs)

**Goal:** Correct data sources for v0.32.1; less jarring UX.

| Task | Details |
|------|---------|
| Enable **`statistics`** in [default config.yml](../feeds/packages/blocky/files/config.yml) | Required for `GET /api/stats`; document in LuCI if disabled |
| Add **`blockyApi('/stats')`** helper + graceful 503 handling | Show “enable statistics in config” banner |
| **Pause countdown** on Dashboard / Controls | Poll `/blocking/status` every 1s when `autoEnableInSec > 0` (blocky-ui pattern) |
| **Stop full reload** after operations | Re-call `load()` data or patch DOM; use notifications only |
| Shared **`blocky-common.js`** module | Deduplicate `blockyApi`, metrics parsers, CSS between `services/blocky.js` and `status/blocky.js` (~1.5k lines duplicated) |

**Acceptance:** With default config, `/stats` returns JSON; pause timer visible; cache flush does not reload entire LuCI page.

---

### Phase 1 — Native statistics dashboard (2–3 PRs)

**Goal:** Match blocky-ui overview + charts using `/api/stats`, reduce reliance on Prometheus label hacks.

| Task | Details |
|------|---------|
| **Overview cards** | Prefer `summary.queries`, `summary.blocked`, `summary.cacheHitRate`, sum of `lists.denylist` counts; fallback to Prometheus if stats 503 |
| **Queries over time** | Chart from `perHour[]` (fixed 24h UTC buckets) — stable without keeping page open |
| **Top lists widget** | `topClients`, `topDomains`, `topBlockedDomains` with tabs or columns (blocky-ui “Top Lists”) |
| **Poll `/stats` every 30–60s** on Dashboard/Status | Lighter than 10s Prometheus poll |
| Status page | Merge or link — avoid maintaining two chart implementations |

**Acceptance:** Top clients/domains work without Prometheus `client` labels; chart shows last 24h after single page load.

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
| `feeds/packages/blocky/files/config.yml` | Add `statistics: enable: true` (exact key per upstream v0.32 docs) |
| `feeds/luci/luci-app-blocky/htdocs/.../blocky-common.js` | **New** — shared API, stats renderers |
| `services/blocky.js` | Consume `/stats`, countdown, reload fixes |
| `status/blocky.js` | Merge with services or thin wrapper |
| `root/usr/share/rpcd/acl.d/luci-app-blocky.json` | Optional log path read |
| `PKG_RELEASE` | Bump on each LuCI publish |

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
