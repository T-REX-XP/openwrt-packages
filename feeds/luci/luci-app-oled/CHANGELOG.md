# luci-app-oled CHANGELOG

## 25 (2026-06-25)

### Fixed
- **oledd segfault / crash loop**: ubus invoke callbacks stored a dangling `blob_attr` pointer and parsed it after `ubus_invoke` returned (use-after-free). Replies are now duplicated with `blob_memdup` and freed after parse.
- **SH1106 I2C errors killed oledd**: `sh1106_init` / `sh1106_upload` called `exit(1)` on transient I2C failures, causing procd respawn flicker. They now return errors; the daemon logs and continues.
- **Boot progress skipped**: `boot_active()` treated a missing `/tmp/oled_state` as boot-complete, jumping straight to menu/rotate. Missing state now means still booting.
- **Late first paint**: display init and BOOTING splash run before ubus/FIFO setup so the panel updates immediately.
- **ubus at START=09**: `ubus_connect` retries for up to ~6s; server poll uses `uloop_run_timeout` instead of deprecated `ubus_handle_event`.

### Changed
- Default `menu_interactive` is `0` (auto-rotate views). Set to `1` in LuCI for button-driven menu list/detail.
- `init.d/oledd`: wait for I2C node, `stderr`/`stdout` to log, respawn throttle `3600 5 0`.
- I2C init retries (15× 500ms) before fatal exit.
- Syslog logging via `openlog("oledd")` on fatal/warning paths.

## 24

- Phase 4: ubus API, boot state file, CM5 i2c-7 / GPIO RST, menu daemon `oledd`.
