# Suricata alert management — plan

**Date:** 2026-09-06  
**Status:** P1 dispatcher + P2 LuCI Alerts in-tree (`tp-notify`, `luci-app-suricata` Alerts tab).  
**Goal:** Let an operator configure **outbound notifications** for Suricata alerts (Telegram, email, webhook, push) on ImmortalWrt / Orange Pi CM5, without turning the router into a SIEM.

Related:

- [suricata-openwrt-plan.md](suricata-openwrt-plan.md) — engine, ET Open, EVE → SQLite, LuCI
- [threat-prevention-openwrt-plan.md](threat-prevention-openwrt-plan.md) — product mapping (events store, not outbound notify)
- [ids-traffic-analysis-openwrt-research.md](ids-traffic-analysis-openwrt-research.md) — CM5 CPU / NPU / mirror
- Skill **`suricata-ids-cm5`** — current LuCI / `tp-eventd` behaviour

---

## 1. Verdict

Suricata **does not** send Telegram, email, Discord, or HTTP webhooks. Native EVE outputs are only **file**, **syslog**, **unix socket**, and **Redis**. Chat and mail are always a **downstream dispatcher**.

This feed already has the first half of the product:

```
Suricata  →  /var/log/suricata/eve.json  →  tp-eventd  →  SQLite ring  →  LuCI Events
```

The missing half is **push**: filter those `event_type=alert` rows and deliver them to a phone or mailbox **without flooding** the operator.

**Recommendation:** add a small **on-router notifier** next to `tp-eventd` (BusyBox + `curl` + optional `msmtp`). Expose it as a LuCI **Alerts** tab on **Services → Suricata**. Do **not** run Apprise, Elasticsearch, Alertmanager, CrowdSec, or Wazuh on the CM5 for this job.

Default: notifications **off**. Only high-severity / selected classtypes / selected SIDs, with a **rate limit** and an optional **hourly digest**.

---

## 2. What is already in the tree

| Piece | Role today |
|-------|------------|
| Suricata EVE file | `/var/log/suricata/eve.json` (`uci suricata.main.eve_path`) |
| `tp-eventd` | `tail -F` EVE → `/var/lib/threat-prevention/events.sqlite` (cap 2000) |
| `tp-eve-ingest` | Keeps `alert` events only: ts, SID, msg, classtype, src/dst, ports, proto, severity |
| LuCI **Events** | Last N rows from SQLite via `luci.suricata.getEvents` |
| Policy / threshold | Classtype action, per-SID suppress (`threshold.config`) — reduces *generation*, not *delivery* |

There is **no** UCI for Telegram, SMTP, webhook, rate limit, or “send this classtype to my phone.” The Events tab is a **log viewer**, not an alerting system.

Synology Threat Prevention also stored events (PostgreSQL) and did **not** expose a first-class Telegram/webhook product in the SPK review. We should not copy that gap.

---

## 3. What Suricata itself supports

Official EVE `filetype` values ([Suricata 8 EVE docs](https://docs.suricata.io/en/suricata-8.0.4/output/eve/eve-json-output.html)):

| Native output | Use on CM5 |
|---------------|------------|
| `regular` (file) | **Keep.** Source of truth for `tp-eventd` and the notifier. |
| `syslog` | **Optional second EVE.** Forward to a remote syslog/SIEM (Tier 3). Not a phone alert. |
| `unix_dgram` / `unix_stream` | Local consumers only. Not needed if we already tail the file. |
| `redis` | Do **not** run Redis on the router for IDS. |

Also native, but not a messaging product:

| Output | Notes |
|--------|--------|
| `fast.log` | Snort-style one-liners. We already prefer EVE JSON. |
| Lua output | Possible, but a Lua plugin per Telegram/email backend is worse than one shell dispatcher. |
| Packet payload in EVE | **Do not** ship payloads to chat/mail. Privacy and size. |

**Implication for LuCI copy:** do not tell users “Suricata supports Telegram.” Tell them Suricata **records** alerts; **this feed** delivers them.

---

## 4. Target architecture

```
br-lan
  │
  └─ suricata (IDS, EVE file — already)
         │
         ▼
   /var/log/suricata/eve.json
         │
         ├─ tp-eventd          SQLite ring + LuCI Events   (existing)
         └─ tp-notify          filter → backends           (new)
                │
                │  match: min severity, classtype, SID
                │  shape: realtime | digest | quiet hours
                │  cap:   N messages / hour / channel
                ▼
         telegram | ntfy | webhook | discord | email | syslog
```

**Process model (preferred):** do **not** add a second `tail -F` of `eve.json`. Hook `tp-eventd` after a successful `tp-eve-ingest`: parsed fields are already in hand. Dispatch **asynchronously** (`tp-notify &`) so a slow Telegram API cannot stall SQLite ingest.

**Package:** keep logic in **`tp-eventd`** (`/usr/sbin/tp-notify`, init unchanged) rather than a new apk. LuCI stays **`luci-app-suricata`**. Optional runtime deps: `curl` + `ca-bundle` (HTTP channels), `msmtp` (email).

If notify I/O or secrets handling outgrows a shell script, split a `tp-notify` package later. v1 should stay shell + `jsonfilter` + `curl`, same style as `tp-eve-ingest`.

---

## 5. Tool and service survey

### 5.1 Do **not** put these on the CM5 for Suricata notify

| Tool | Why it exists | Why not here |
|------|----------------|--------------|
| **Apprise** / Apprise API | One URL scheme for 100+ backends (Telegram, mailto, ntfy, Discord, Slack, …) | Python (or a Docker API). Too heavy; we can speak the same HTTP APIs with `curl`. Use Apprise **off-router** if the operator already runs it — webhook to that host. |
| **Prometheus Alertmanager** | Dedup, inhibit, route | Needs metrics scrape + Alertmanager process. Suricata alerts are events, not gauges. |
| **ElastAlert2** + Elasticsearch | Query ES, then notify | Full ELK on a router is out. Tier 3 only. |
| **Wazuh / SELKS / EveBox server** | SIEM / Suricata UI | Already Tier 3 (mirror host). They have their own notifiers. |
| **CrowdSec notification plugins** | Slack, email, HTTP, Splunk | CrowdSec is a different engine. OpenWrt plugin paths are already painful. Do not add CrowdSec just to send Suricata mail. |
| **Kafka / Redis on-router** | Suricata can push EVE to Redis | Extra daemon, no phone. |
| **`luci-app-wechatpush`** | OpenWrt Telegram / WeChat / msmtp for *router* events (WAN IP, clients) | Fine as a **separate** app for device online/offline. Do not depend on it for IDS; it does not speak EVE. |

### 5.2 First-class channels (ship in LuCI)

These are the backends operators actually want, and they map to **one HTTPS POST or SMTP** from BusyBox.

| Channel | Service / tool | How we send | CM5 fit | Notes |
|---------|----------------|-------------|---------|--------|
| **Telegram** | [Bot API](https://core.telegram.org/bots/api) `sendMessage` | `curl` POST `https://api.telegram.org/bot<token>/sendMessage` | **Excellent** | Create bot via [@BotFather](https://t.me/BotFather); `chat_id` from a group or user. MarkdownV2 is fragile; send **plain text**. |
| **ntfy** | [ntfy.sh](https://ntfy.sh) or self-hosted [ntfy](https://docs.ntfy.sh/) | `curl -d` / PUT to `https://ntfy.sh/<topic>` | **Excellent** | Phone apps (Android/iOS). Topic is the secret on the public server — use a long random name or self-host + token. Maps Suricata severity → ntfy `Priority` (1–5). |
| **Webhook** | Any HTTPS URL (Home Assistant, n8n, Apprise API, Discord-compatible, custom) | `curl -H Content-Type:application/json` | **Excellent** | Slim JSON (below), not raw EVE. Optional extra headers (Bearer). |
| **Email** | OpenWrt **`msmtp`** | `msmtp -a suricata_notify` | **Good** | Same pattern as **banIP** (`ban_mail*` + `/etc/msmtprc`). Do not vendor a mailer. Digest mode preferred (one mail / hour), not one mail per SID. |
| **Discord** | Incoming webhook | `curl` JSON `{ "content": "..." }` | **Good** | Thin preset over webhook (URL shape `discord.com/api/webhooks/…`). Same privacy rules. |
| **Syslog** | Suricata native `eve-log` `filetype: syslog`, or `logger` | UDP/TCP to NAS / rsyslog | **Good** | For operators who already have a log host. Not a substitute for Telegram. |

### 5.3 Second-class (document, do not build a dedicated form)

| Channel | How |
|---------|-----|
| **Slack** | Incoming webhook URL in the generic **Webhook** type (`text` or Block Kit later). |
| **Pushover / Gotify / Pushbullet** | Generic webhook, or ntfy instead (same job, simpler). |
| **Matrix / Signal** | No first-party HTTP that is safe to ship. Point webhook at a **bridges** host (Apprise API, `signal-cli`). |
| **PagerDuty / OpsGenie** | Overkill for a home/lab CM5. Webhook if someone insists. |
| **WeChat / Server酱 / PushPlus** | Point operators at `luci-app-wechatpush` for *router* events; IDS stays on webhook if they need it. |

### 5.4 Suggested operator setups

**Home / travel router (default recommendation)**

1. **ntfy** (phone) *or* **Telegram** bot — pick one realtime channel.  
2. Optional **email digest** via `msmtp` (Gmail app password, Fastmail, or a real SMTP).  
3. Leave webhook empty.

**Homelab with Home Assistant / n8n**

1. **Webhook** to HA / n8n (then HA notifies phones, TTS, etc.).  
2. Optional ntfy as a backup path.

**Already running a SIEM (Tier 3)**

1. Enable Suricata **syslog** EVE (or ship `eve.json` with Vector/Filebeat on the *analysis host*).  
2. Let Wazuh / EveBox / Grafana own paging.  
3. Keep on-router Telegram **off** to avoid double-noise.

---

## 6. Filtering — the real product

ET Open on a busy LAN will produce more alerts than any chat app can stand. Delivery must be **opt-in and lossy**.

### 6.1 Reduce at the engine (already exists)

Use these **before** notify:

- Small vs full rule profile; disable noisy rulesets on **Policy**.
- Per-SID **Review / Expire / Disable** (threshold).
- Classtype default `alert` vs `pass`.

Notify is not a substitute for a quiet policy.

### 6.2 Reduce at the dispatcher (new)

Each channel (or a global `notify` section) should support:

| Control | Default | Why |
|---------|---------|-----|
| `enabled` | `0` | No surprise messages after sysupgrade. |
| `min_severity` | `1` (high only; Suricata 1=high, 3=low) | Severity 3 “potentially bad traffic” is chat spam. |
| `classtype` list | empty = all that pass severity | e.g. only `trojan-activity`, `attempted-admin`. |
| `sid` allow / deny | empty | Pin a few C2 SIDs; deny a flapping SID without disabling detection. |
| `mode` | `digest` | `realtime` = one message per alert; `digest` = at most one summary per interval. |
| `rate_limit` | `12` / hour / channel | Hard cap even in realtime. Drop + increment “suppressed” counter. |
| `quiet_hours` | off | Optional local-time window (sleep). Queue into next digest. |
| `include_lan` | `1` | If `0`, redact src/dst to `/24` or `x.x.x.x`. |

**Digest body (example):**

```text
Suricata 12:00–13:00
  14 alerts (8 suppressed by rate limit)
  2100498 ET TROJAN … × 9   203.0.113.4 → 192.168.8.20
  2018364 ET C2 …         × 5   …
```

LuCI must show **last send time**, **last error** (no secrets), and **suppressed count** so a silent channel is diagnosable.

---

## 7. Payload contract (webhook)

Never POST the raw EVE line (HTTP headers, files, payloads). Use the same columns as SQLite:

```json
{
  "source": "suricata",
  "host": "OpenWrt",
  "ts": "2026-09-06T09:12:03.123456+0000",
  "sid": 2100498,
  "gid": 1,
  "msg": "ET TROJAN example",
  "classtype": "trojan-activity",
  "severity": 1,
  "src": "203.0.113.4",
  "sport": "443",
  "dst": "192.168.8.20",
  "dport": "51234",
  "proto": "TCP"
}
```

Telegram / ntfy / Discord / email get a **one-screen text** rendering of the same fields. Optional later: `payload=1` for webhook-only operators who want full EVE (off by default, ACL-sensitive).

---

## 8. UCI sketch

New list-type sections on `suricata` (not a second config file). Secrets stay in UCI; `conffiles` already preserves `/etc/config/suricata`. File mode `600`.

```
config notify 'telegram'
	option enabled '0'
	option type 'telegram'
	option bot_token ''
	option chat_id ''
	option min_severity '1'
	option mode 'digest'
	option interval '3600'
	option rate_limit '12'

config notify 'ntfy'
	option enabled '0'
	option type 'ntfy'
	option url 'https://ntfy.sh/'
	option topic ''
	option token ''
	option min_severity '1'
	option mode 'realtime'
	option rate_limit '20'

config notify 'webhook'
	option enabled '0'
	option type 'webhook'
	option url ''
	option header ''

config notify 'email'
	option enabled '0'
	option type 'email'
	option to ''
	option msmtp_account 'suricata_notify'
	option mode 'digest'
	option interval '3600'
```

`type` enum for v1: `telegram` | `ntfy` | `webhook` | `discord` | `email`.

Syslog stays engine config (`suricata-config-apply` optional second `eve-log`), not a `notify` section, so we do not duplicate Suricata’s own syslog writer.

---

## 9. LuCI (Services → Suricata)

New tab **Alerts** (after **Events**). Follow existing Suricata UX rules: footer **Save & Apply** only, Bootstrap CSS variables, `rpc.declare` + `expect`, no CM5/2.5 GbE prose, no Blocky/Snort header links.

| Control | Behaviour |
|---------|-----------|
| Channel list | Type, enabled, destination (masked token), mode, min severity |
| Add channel | One of the v1 types |
| Test | `ubus call luci.suricata notifyTest` → send a synthetic line, return `{ ok, error }` without echoing secrets |
| Help | Short: “Suricata only writes logs; this tab sends them. Start with digest + severity 1.” |
| Status | Last success / last HTTP status / suppressed |

**Settings tab** may grow a single checkbox **Also write EVE to syslog** (native Suricata). Do not mix syslog credentials into the Alerts form.

rpcd: new methods `getNotify`, `setNotify`, `notifyTest`. Helpers **above** first caller (`'use strict'`). Do not put `{` `}` in ucode regex. ACL: admin session only; do not grant `file` read of `/etc/config/suricata` to extra roles.

---

## 10. Security and ops

1. **Secrets:** bot tokens, ntfy tokens, webhook Bearer. Never log them (`logger` redacts). LuCI shows `••••` after save. Backup (`sysupgrade -b`) **will** include UCI — document that.  
2. **TLS:** `curl` + `ca-bundle`; do not add `insecure` by default.  
3. **Timeouts:** `curl --max-time 8 --retry 0` so a dead API cannot wedge procd.  
4. **No payload / no full URI lists** in chat.  
5. **ntfy.sh public topics** are guessable if short — LuCI help must say “long random topic or self-host.”  
6. **Telegram:** do not scrape updates with long-poll on the router; outbound `sendMessage` only.  
7. **Email:** reuse `/etc/msmtprc`; do not store SMTP password in `suricata` UCI if `msmtp` already has it (banIP model).  
8. **Rate limit persistence:** `/tmp/tp-notify-state` is enough (lost on reboot is fine).  
9. **Failure:** increment error counter, do not disable Suricata or `tp-eventd`.

---

## 11. Phases

### P0 — this document (now)

- [x] Native vs downstream split, tool survey, CM5 recommendation.

### P1 — dispatcher (no LuCI)

- [x] `tp-notify` + hook from `tp-eventd` after ingest.
- [x] UCI parse; Telegram + ntfy + webhook + email (+ Discord).
- [x] Severity / classtype / SID / rate-limit / digest.
- [x] Host tests: fixture EVE line → dry-run curl argv (no network).
- [x] `PKG_RELEASE` bump on `tp-eventd`. Optional `DEPENDS:=+curl`.

### P2 — LuCI Alerts tab

- [x] Channel CRUD, Test, last-error, masked secrets.
- [x] Footer Save & Apply; rpcd methods + ACL.
- [x] `PKG_RELEASE` bump on `luci-app-suricata`.

### P3 — Discord preset + syslog EVE

- Discord as webhook preset.
- `suricata-config-apply`: optional second `eve-log` `filetype: syslog`.

### P4 — optional niceties (only if P2 is used)

- Quiet hours, LAN redaction, MCU high-severity one-liner (via existing `mcudd` path — **not** a new RDCP opcode).
- Snort3 `alert_json` reuse of the same `tp-notify` (same slim JSON). Do not block P1 on Snort.

---

## 12. Dependencies (runtime)

| Package | When |
|---------|------|
| `curl`, `ca-bundle` | Any HTTP channel (Telegram, ntfy, webhook, Discord) |
| `msmtp` | Email channel; operator configures `/etc/msmtprc` |
| `jsonfilter`, `sqlite3-cli` | Already on `tp-eventd` |
| `logger` / busybox | Syslog leftover / errors |

Do **not** add Python, Go notify daemons, or Redis to `DEVICE_PACKAGES` for this.

---

## 13. Will not do

1. Teach Suricata to speak Telegram inside `suricata.yaml`.  
2. Run Apprise, Alertmanager, Elasticsearch, Wazuh, or CrowdSec on the CM5 as the notifier.  
3. Second `tail -F` of `eve.json` (race with `tp-eventd`).  
4. One email/Telegram per low-severity ET Open hit with no cap.  
5. Forward packet payloads or full EVE to chat.  
6. Depend on `luci-app-wechatpush` for IDS.  
7. PostgreSQL / Barnyard2 (already rejected in the engine plan).  
8. Inline IPS as a side effect of “alerting.”

---

## 14. Decision (recommended)

| Question | Recommendation |
|----------|----------------|
| Where does notify live? | **`tp-eventd` hook**, not a new engine output and not a new apk in v1. |
| Which channels in LuCI v1? | **Telegram, ntfy, webhook, email.** Discord in P3. |
| Default mode? | **Off**, then **digest + min_severity 1**. |
| Unified library (Apprise)? | **No on-router.** Webhook to an existing Apprise host is enough. |
| Syslog? | **Native Suricata EVE syslog**, optional, for SIEM — not a chat backend. |
| Snort3? | Same dispatcher later; Suricata first. |

Accept this plan → implement P1 (shell dispatcher + tests) then P2 (LuCI Alerts).
