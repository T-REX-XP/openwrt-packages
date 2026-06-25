/*
 * oledd_ubus — libubus client helpers for oledd (Phase 2).
 */

#ifndef OLEDD_UBUS_H
#define OLEDD_UBUS_H

#include <stddef.h>

struct ubus_context;

struct oledd_system_info {
	unsigned long uptime;
	float load1;
	unsigned long mem_total;
	unsigned long mem_free;
};

struct oledd_dev_status {
	int up;
	int carrier;
};

struct oledd_wifi_info {
	char ssid[33];
	int num_sta;
	char channel[8];
	int valid;
};

struct ubus_context *oledd_ubus_open(void);
void oledd_ubus_close(struct ubus_context *ctx);

int oledd_ubus_system_info(struct ubus_context *ctx,
			   struct oledd_system_info *info);

int oledd_ubus_device_status(struct ubus_context *ctx, const char *device,
			     struct oledd_dev_status *st);

int oledd_ubus_interface_ipv4(struct ubus_context *ctx, const char *iface,
			      char *addr, size_t len);

int oledd_ubus_wifi_status(struct ubus_context *ctx,
			   struct oledd_wifi_info *wifi);

#endif /* OLEDD_UBUS_H */
