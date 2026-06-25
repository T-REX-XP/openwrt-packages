/*
 * oledd_alert — WAN / load error overlays (Phase 4).
 */

#ifndef OLEDD_ALERT_H
#define OLEDD_ALERT_H

struct ubus_context;

void oledd_alert_init(int enabled);
void oledd_alert_poll(struct ubus_context *ctx);
void oledd_alert_draw(void);

#endif /* OLEDD_ALERT_H */
