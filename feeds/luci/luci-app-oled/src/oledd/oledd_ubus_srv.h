/*
 * oledd_ubus_srv — ubus control object for oledd (Phase 4).
 */

#ifndef OLEDD_UBUS_SRV_H
#define OLEDD_UBUS_SRV_H

struct ubus_context;

int oledd_ubus_srv_register(struct ubus_context *ctx, const char *i2c_path,
			    int menu_interactive);
void oledd_ubus_srv_poll(struct ubus_context *ctx);
void oledd_ubus_srv_unregister(struct ubus_context *ctx);

#endif /* OLEDD_UBUS_SRV_H */
