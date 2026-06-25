/*
 * oledd_wifi_ap — active WiFi AP detection and join QR payload.
 */

#ifndef OLEDD_WIFI_AP_H
#define OLEDD_WIFI_AP_H

#include <stddef.h>

struct ubus_context;

struct oledd_wifi_ap_info {
	int active;
	int open;
	char ssid[33];
	char ifname[16];
	char qr_payload[160];
};

int oledd_wifi_ap_refresh(struct ubus_context *ctx,
			  struct oledd_wifi_ap_info *ap);

void oledd_wifi_ap_build_qr(const char *ssid, const char *key, int open,
			    char *out, size_t out_len);

#endif /* OLEDD_WIFI_AP_H */
