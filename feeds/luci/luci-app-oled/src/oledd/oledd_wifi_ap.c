/*
 * oledd_wifi_ap — active WiFi AP detection and join QR payload.
 */

#include "oledd_wifi_ap.h"

#include <libubox/blobmsg.h>
#include <libubus.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define UBUS_TIMEOUT_MS 3000

struct ubus_call_ctx {
	struct blob_attr *reply;
};

static void ubus_data_cb(struct ubus_request *req, int type, struct blob_attr *msg)
{
	struct ubus_call_ctx *ctx = req->priv;

	(void)type;
	free(ctx->reply);
	ctx->reply = NULL;
	if (!msg || !ctx)
		return;
	ctx->reply = blob_memdup(msg);
}

static int ubus_invoke_simple(struct ubus_context *ctx, const char *path,
			      const char *method, struct blob_attr *msg,
			      struct blob_attr **out)
{
	struct ubus_call_ctx call = { .reply = NULL };
	uint32_t id;
	int ret;

	if (!ctx)
		return -1;

	ret = ubus_lookup_id(ctx, path, &id);
	if (ret)
		return ret;

	ret = ubus_invoke(ctx, id, method, msg, ubus_data_cb, &call,
			  UBUS_TIMEOUT_MS);
	if (ret) {
		free(call.reply);
		return ret;
	}

	if (!call.reply)
		return -1;

	if (out) {
		*out = call.reply;
		return 0;
	}

	free(call.reply);
	return 0;
}

static int uci_get_wireless(const char *section, const char *option,
			    char *out, size_t out_len)
{
	char cmd[128];
	FILE *f;

	if (!section || !option || !out || out_len == 0)
		return -1;

	out[0] = '\0';
	snprintf(cmd, sizeof(cmd), "uci -q get wireless.%s.%s 2>/dev/null",
		 section, option);
	f = popen(cmd, "r");
	if (!f)
		return -1;
	if (!fgets(out, (int)out_len, f)) {
		pclose(f);
		out[0] = '\0';
		return -1;
	}
	pclose(f);
	out[strcspn(out, "\r\n")] = '\0';
	return out[0] ? 0 : -1;
}

static int encryption_is_open(const char *enc)
{
	if (!enc || !enc[0])
		return 1;
	if (!strcmp(enc, "none"))
		return 1;
	if (!strncmp(enc, "owe", 3))
		return 1;
	return 0;
}

static void qr_escape(const char *in, char *out, size_t out_len)
{
	size_t o = 0;
	const char *p;

	if (!out || out_len == 0)
		return;
	out[0] = '\0';
	if (!in)
		return;

	for (p = in; *p && o + 2 < out_len; p++) {
		if (*p == '\\' || *p == ';' || *p == ':' || *p == ',' ||
		    *p == '"') {
			out[o++] = '\\';
			if (o >= out_len - 1)
				break;
		}
		out[o++] = *p;
	}
	out[o] = '\0';
}

void oledd_wifi_ap_build_qr(const char *ssid, const char *key, int open,
			    char *out, size_t out_len)
{
	char essid[72];
	char psk[80];

	if (!out || out_len == 0)
		return;
	out[0] = '\0';
	if (!ssid || !ssid[0])
		return;

	qr_escape(ssid, essid, sizeof(essid));
	if (open) {
		snprintf(out, out_len, "WIFI:T:nopass;S:%s;;", essid);
		return;
	}

	qr_escape(key ? key : "", psk, sizeof(psk));
	snprintf(out, out_len, "WIFI:T:WPA;S:%s;P:%s;;", essid, psk);
}

enum {
	HAP_SSID,
	HAP_STATE,
	__HAP_MAX,
};

static const struct blobmsg_policy hap_policy[__HAP_MAX] = {
	[HAP_SSID] = { .name = "ssid", .type = BLOBMSG_TYPE_STRING },
	[HAP_STATE] = { .name = "state", .type = BLOBMSG_TYPE_STRING },
};

static int hostapd_ap_active(struct ubus_context *ctx, const char *path,
			     struct oledd_wifi_ap_info *ap)
{
	struct blob_attr *reply = NULL;
	struct blob_attr *tb[__HAP_MAX];
	const char *ssid, *state;

	if (ubus_invoke_simple(ctx, path, "get_status", NULL, &reply) != 0)
		return -1;

	blobmsg_parse(hap_policy, __HAP_MAX, tb, blob_data(reply),
		      blob_len(reply));
	free(reply);

	if (!tb[HAP_SSID])
		return -1;

	ssid = blobmsg_get_string(tb[HAP_SSID]);
	if (!ssid[0])
		return -1;

	if (tb[HAP_STATE]) {
		state = blobmsg_get_string(tb[HAP_STATE]);
		if (state[0] && strcmp(state, "ENABLED"))
			return -1;
	}

	strncpy(ap->ssid, ssid, sizeof(ap->ssid) - 1);
	ap->ssid[sizeof(ap->ssid) - 1] = '\0';
	ap->active = 1;
	return 0;
}

enum {
	WL_IFACES,
	__WL_MAX,
};

static const struct blobmsg_policy wl_policy[__WL_MAX] = {
	[WL_IFACES] = { .name = "interfaces", .type = BLOBMSG_TYPE_ARRAY },
};

enum {
	WLI_SECTION,
	WLI_IFNAME,
	WLI_SSID,
	WLI_UP,
	WLI_MODE,
	__WLI_MAX,
};

static const struct blobmsg_policy wli_policy[__WLI_MAX] = {
	[WLI_SECTION] = { .name = "section", .type = BLOBMSG_TYPE_STRING },
	[WLI_IFNAME] = { .name = "ifname", .type = BLOBMSG_TYPE_STRING },
	[WLI_SSID] = { .name = "ssid", .type = BLOBMSG_TYPE_STRING },
	[WLI_UP] = { .name = "up", .type = BLOBMSG_TYPE_BOOL },
	[WLI_MODE] = { .name = "config", .type = BLOBMSG_TYPE_TABLE },
};

enum {
	WLC_MODE,
	__WLC_MAX,
};

static const struct blobmsg_policy wlc_policy[__WLC_MAX] = {
	[WLC_MODE] = { .name = "mode", .type = BLOBMSG_TYPE_STRING },
};

static int wireless_ap_from_status(struct ubus_context *ctx,
				   struct oledd_wifi_ap_info *ap)
{
	struct blob_attr *reply = NULL;
	struct blob_attr *tb[__WL_MAX];
	struct blob_attr *cur;
	int rem;

	if (ubus_invoke_simple(ctx, "network.wireless", "status", NULL,
			       &reply) != 0)
		return -1;

	blobmsg_parse(wl_policy, __WL_MAX, tb, blob_data(reply),
		      blob_len(reply));
	if (!tb[WL_IFACES]) {
		free(reply);
		return -1;
	}

	rem = blobmsg_data_len(tb[WL_IFACES]);
	blobmsg_for_each_attr(cur, tb[WL_IFACES], rem) {
		struct blob_attr *itb[__WLI_MAX];
		struct blob_attr *ctb[__WLC_MAX];
		const char *section, *ifname, *ssid, *mode = NULL;
		char hostapd_path[48];
		char enc[32];
		char key[64];

		blobmsg_parse(wli_policy, __WLI_MAX, itb, blobmsg_data(cur),
			      blobmsg_data_len(cur));

		if (itb[WLI_MODE]) {
			blobmsg_parse(wlc_policy, __WLC_MAX, ctb,
				      blobmsg_data(itb[WLI_MODE]),
				      blobmsg_data_len(itb[WLI_MODE]));
			if (ctb[WLC_MODE])
				mode = blobmsg_get_string(ctb[WLC_MODE]);
		}
		if (mode && strcmp(mode, "ap"))
			continue;
		if (itb[WLI_UP] && !blobmsg_get_bool(itb[WLI_UP]))
			continue;
		if (!itb[WLI_SSID])
			continue;

		ssid = blobmsg_get_string(itb[WLI_SSID]);
		if (!ssid[0])
			continue;

		section = itb[WLI_SECTION] ?
		    blobmsg_get_string(itb[WLI_SECTION]) : NULL;
		ifname = itb[WLI_IFNAME] ?
		    blobmsg_get_string(itb[WLI_IFNAME]) : NULL;

		strncpy(ap->ssid, ssid, sizeof(ap->ssid) - 1);
		ap->ssid[sizeof(ap->ssid) - 1] = '\0';
		if (ifname) {
			strncpy(ap->ifname, ifname, sizeof(ap->ifname) - 1);
			ap->ifname[sizeof(ap->ifname) - 1] = '\0';
		}

		enc[0] = '\0';
		key[0] = '\0';
		if (section) {
			uci_get_wireless(section, "encryption", enc, sizeof(enc));
			uci_get_wireless(section, "key", key, sizeof(key));
		}
		ap->open = encryption_is_open(enc);
		ap->active = 1;

		if (ifname && ifname[0]) {
			snprintf(hostapd_path, sizeof(hostapd_path),
				 "hostapd.%s", ifname);
			if (hostapd_ap_active(ctx, hostapd_path, ap) != 0) {
				/* wireless says AP up; keep ssid from wireless */
				strncpy(ap->ssid, ssid, sizeof(ap->ssid) - 1);
				ap->ssid[sizeof(ap->ssid) - 1] = '\0';
			}
		}

		oledd_wifi_ap_build_qr(ap->ssid, key, ap->open, ap->qr_payload,
				       sizeof(ap->qr_payload));
		free(reply);
		return 0;
	}

	free(reply);
	return -1;
}

static int uci_section_for_ap(const char *ssid, char *section, size_t section_len)
{
	char cmd[160];
	char line[256];
	FILE *f;

	if (!ssid || !ssid[0] || !section || section_len == 0)
		return -1;

	snprintf(cmd, sizeof(cmd),
		 "uci -q show wireless 2>/dev/null | grep -F \"=%s\"" , ssid);
	f = popen(cmd, "r");
	if (!f)
		return -1;

	while (fgets(line, sizeof(line), f)) {
		char *dot, *eq;

		eq = strchr(line, '=');
		if (!eq)
			continue;
		*eq = '\0';
		if (strstr(line, ".ssid") == NULL)
			continue;
		dot = strrchr(line, '.');
		if (!dot)
			continue;
		*dot = '\0';
		dot = strchr(line, '.');
		if (!dot)
			continue;
		strncpy(section, dot + 1, section_len - 1);
		section[section_len - 1] = '\0';
		pclose(f);
		return section[0] ? 0 : -1;
	}

	pclose(f);
	return -1;
}

static int try_hostapd_paths(struct ubus_context *ctx,
			     struct oledd_wifi_ap_info *ap)
{
	static const char *paths[] = {
		"hostapd.phy0-ap0", "hostapd.phy1-ap0",
		"hostapd.phy0-ap1", "hostapd.phy1-ap1",
		"hostapd.wlan0", "hostapd.wlan1",
	};
	char enc[32];
	char key[64];
	char section[32];
	unsigned int i;

	for (i = 0; i < sizeof(paths) / sizeof(paths[0]); i++) {
		const char *slash;

		if (hostapd_ap_active(ctx, paths[i], ap) != 0)
			continue;

		section[0] = '\0';
		if (uci_section_for_ap(ap->ssid, section, sizeof(section)) != 0) {
			slash = strrchr(paths[i], '.');
			if (slash)
				snprintf(section, sizeof(section), "default_radio%s",
					 !strcmp(slash + 1, "wlan1") ||
					 strstr(slash + 1, "phy1") ? "1" : "0");
		}
		enc[0] = '\0';
		key[0] = '\0';
		if (section[0]) {
			uci_get_wireless(section, "encryption", enc, sizeof(enc));
			uci_get_wireless(section, "key", key, sizeof(key));
		}
		ap->open = encryption_is_open(enc);
		oledd_wifi_ap_build_qr(ap->ssid, key, ap->open, ap->qr_payload,
				       sizeof(ap->qr_payload));
		return 0;
	}
	return -1;
}

int oledd_wifi_ap_refresh(struct ubus_context *ctx, struct oledd_wifi_ap_info *ap)
{
	if (!ap)
		return -1;

	memset(ap, 0, sizeof(*ap));

	if (!ctx)
		return -1;

	if (wireless_ap_from_status(ctx, ap) == 0)
		return 0;

	if (try_hostapd_paths(ctx, ap) == 0)
		return 0;

	return -1;
}
