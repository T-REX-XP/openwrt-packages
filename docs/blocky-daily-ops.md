# Blocky on ImmortalWrt — daily operations

Quick reference for **luci-app-blocky** on Orange Pi CM5 Base (and similar routers). Blocky **v0.34.x** listens on `127.0.0.1:5353` (DNS) and `127.0.0.1:4000` (HTTP API).

**LuCI:** Services → Blocky  
**Active backlog / architecture:** [luci-app-blocky-review-and-backlog.md](luci-app-blocky-review-and-backlog.md)

---

## First-time setup

1. Install **`blocky`** + **`luci-app-blocky`** from the [openwrt-packages feed](https://github.com/T-REX-XP/openwrt-packages) (not in default CM5 firmware).
2. Enable and start the service: **Dashboard → Controls** section → **Enable on boot** + **Start**.
3. Turn on LAN DNS forwarding: **Configuration → Router DNS** → **Use Blocky for all LAN / Wi-Fi DNS** (chains dnsmasq `:53` → Blocky `:5353`).
4. Add block lists: **Block lists** tab → catalog or custom URLs → **Save & restart Blocky**.
5. Confirm on a Wi-Fi client: DNS server = router LAN IP (e.g. `192.168.8.1`); browse an ad-test page.

---

## Daily checks (2 minutes)

| Check | Where | Healthy signal |
|-------|--------|----------------|
| Service running | Dashboard status bar / pipeline | Blocky **Running**, API reachable |
| Blocking active | Dashboard / Statistics | Blocking **Enabled** (or paused with countdown) |
| dnsmasq forward | Configuration → Router DNS | Forwarding **Yes** |
| Lists loaded | Dashboard summary / Block lists | Denylist entry count > 0 or “pending” clears |
| Errors | **Debug** tab | No crash loop in syslog |

---

## Common tasks

### Pause blocking temporarily

**Dashboard → Controls → Blocking Controls** — preset (5m–30m) or custom duration + **Pause**.

### Refresh block lists after URL changes

1. Edit lists on **Block lists** tab (UCI).
2. **Update lists now** or **Save & restart Blocky** (syncs UCI → `config.yml`, restarts, calls Blocky refresh API).

### Change upstream DNS or ports

**Configuration** → structured sections → **Save settings** (no restart) or **Save & restart Blocky**. YAML is validated before write.

### Inspect a domain

- **Logs → Query log** — click a domain → jumps to **DNS Query** tab.
- Or **DNS Query** tab directly → enter name + type → **Query**.

### View service errors

**Logs → Service log** or **Debug** tab — `logread -e blocky` (truncated tail).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Wi-Fi clients resolve nothing | Blocky stopped or dnsmasq not forwarding | Start Blocky; enable Router DNS integration |
| Lists show 0 rules | Bootstrap DNS or download failure | Check **Debug** logs; verify WAN; **Refresh lists** |
| Statistics empty | `statistics.enable: false` | Configuration → Security → enable statistics; restart |
| Save fails validation | Invalid YAML | Read error toast; fix in Configuration or Advanced YAML |
| Query log empty | Wrong `queryLog.target` or tmpfs cleared | Default `/tmp/blocky-logs`; reboot clears tmpfs logs |

---

## Files & ports

| Path | Purpose |
|------|---------|
| `/etc/blocky/config.yml` | Blocky main config |
| `/etc/config/blocky` | UCI blocklists + dnsmasq forward flag |
| `/tmp/blocky-logs/` | CSV query logs (tmpfs) |
| `127.0.0.1:5353` | Blocky DNS (internal) |
| `127.0.0.1:4000` | HTTP API + `/metrics` |
| `:53` on LAN | dnsmasq (clients use this) |

---

## References

- [luci-app-blocky feature plan (API history)](luci-app-blocky-feature-plan.md)
- [Blocky upstream docs](https://0xerr0r.github.io/blocky/)
- [OpenAPI v0.34](https://github.com/0xERR0R/blocky/blob/v0.34.0/docs/api/openapi.yaml)
