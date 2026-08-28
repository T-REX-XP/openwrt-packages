# luci-app-blocky host tests

Runs on macOS/Linux with **Node.js 18+** and `/bin/sh`. No OpenWrt SDK or router required.

## Run

```sh
cd feeds/luci/luci-app-blocky/tests
./run-tests.sh
```

## Layout

| File | Purpose |
|------|---------|
| `blocky-parse.test.mjs` | Pure parsers: metrics, ports, CSV, stats RPC shape, chart math, HTTP/log validation |
| `blocky-config.test.mjs` | YAML ↔ settings round-trip using `tests/fixtures/config.yml` |
| `luci-blocky-validation.test.mjs` | Mirrors `luci.blocky.uc` path allowlist rules |
| `test-blocky-http-api.sh` | Sources `blocky-http-api` and checks port parsing |
| `test-blocky-dnsmasq-sync.sh` | Upstream `127.0.0.1#port` format and port bounds |

## Modules under test

- `blocky-parse-core.js` — metrics, ports, CSV, validation helpers (100% pure-logic target)
- `blocky-config-core.js` — settings YAML parse/build/patch
- `blocky-base.js` — shared RPC, fetch, tabs, page bootstrap
- `blocky-tab-*.js` — per-tab UI (dashboard, stats, blocklists, config, controls, query, logs)
- `blocky-common.js` — thin view shell (~170 lines); DOM/LuCI views not unit-tested here

`run-tests.sh` also runs `node --check` on every `blocky*.js` resource.

Load helpers: `load-core.mjs` evaluates LuCI core modules via `new Function` (same pattern as `luci-app-oled/tests`).

## Coverage goal (Epic A)

**100% line coverage** target applies to extractable pure logic in `blocky-parse-core.js` and `blocky-config-core.js`, not LuCI views or rpcd on-router.

CI job `test-blocky` runs this suite on every PR touching `feeds/luci/luci-app-blocky/` or `feeds/packages/blocky/`.
