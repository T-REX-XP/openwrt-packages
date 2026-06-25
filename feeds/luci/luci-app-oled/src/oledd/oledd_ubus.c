/*
 * oledd_ubus — libubus client helpers for oledd (Phase 2).
 */

#include "oledd_ubus.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <libubus.h>
#include <libubox/blobmsg.h>
#include <libubox/utils.h>

#define UBUS_TIMEOUT_MS 3000
#define UBUS_CONNECT_RETRIES 30
#define UBUS_CONNECT_DELAY_US 200000

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

struct ubus_context *oledd_ubus_open(void)
{
	struct ubus_context *ctx = NULL;
	int i;

	for (i = 0; i < UBUS_CONNECT_RETRIES; i++) {
		ctx = ubus_connect(NULL);
		if (ctx)
			return ctx;
		usleep(UBUS_CONNECT_DELAY_US);
	}

	fprintf(stderr, "oledd: ubus_connect failed after %d retries\n",
		UBUS_CONNECT_RETRIES);
	return NULL;
}

void oledd_ubus_close(struct ubus_context *ctx)
{
	if (ctx)
		ubus_free(ctx);
}

enum {
	SYS_UPTIME,
	SYS_LOAD,
	SYS_MEMORY,
	__SYS_MAX,
};

static const struct blobmsg_policy sys_policy[__SYS_MAX] = {
	[SYS_UPTIME] = { .name = "uptime", .type = BLOBMSG_TYPE_INT32 },
	[SYS_LOAD] = { .name = "load", .type = BLOBMSG_TYPE_ARRAY },
	[SYS_MEMORY] = { .name = "memory", .type = BLOBMSG_TYPE_TABLE },
};

enum {
	MEM_TOTAL,
	MEM_FREE,
	__MEM_MAX,
};

static const struct blobmsg_policy mem_policy[__MEM_MAX] = {
	[MEM_TOTAL] = { .name = "total", .type = BLOBMSG_TYPE_INT32 },
	[MEM_FREE] = { .name = "free", .type = BLOBMSG_TYPE_INT32 },
};

int oledd_ubus_system_info(struct ubus_context *ctx,
			   struct oledd_system_info *info)
{
	struct blob_attr *reply = NULL;
	struct blob_attr *tb[__SYS_MAX];
	struct blob_attr *mem_tb[__MEM_MAX];
	struct blob_attr *cur;
	int rem;
	uint32_t load0 = 0;

	if (!info)
		return -1;

	memset(info, 0, sizeof(*info));

	if (ubus_invoke_simple(ctx, "system", "info", NULL, &reply) != 0)
		return -1;

	blobmsg_parse(sys_policy, __SYS_MAX, tb, blob_data(reply),
		      blob_len(reply));

	if (tb[SYS_UPTIME])
		info->uptime = (unsigned long)blobmsg_get_u32(tb[SYS_UPTIME]);

	if (tb[SYS_LOAD]) {
		rem = blobmsg_data_len(tb[SYS_LOAD]);
		blobmsg_for_each_attr(cur, tb[SYS_LOAD], rem) {
			if (blobmsg_type(cur) == BLOBMSG_TYPE_INT32) {
				load0 = blobmsg_get_u32(cur);
				break;
			}
		}
		info->load1 = (float)load0 / 65536.0f;
	}

	if (tb[SYS_MEMORY]) {
		blobmsg_parse(mem_policy, __MEM_MAX, mem_tb,
			      blobmsg_data(tb[SYS_MEMORY]),
			      blobmsg_data_len(tb[SYS_MEMORY]));
		if (mem_tb[MEM_TOTAL])
			info->mem_total =
			    (unsigned long)blobmsg_get_u32(mem_tb[MEM_TOTAL]);
		if (mem_tb[MEM_FREE])
			info->mem_free =
			    (unsigned long)blobmsg_get_u32(mem_tb[MEM_FREE]);
	}

	free(reply);
	return 0;
}

enum {
	DEV_UP,
	DEV_LINK,
	DEV_CARRIER,
	__DEV_MAX,
};

static const struct blobmsg_policy dev_policy[__DEV_MAX] = {
	[DEV_UP] = { .name = "up", .type = BLOBMSG_TYPE_BOOL },
	[DEV_LINK] = { .name = "link", .type = BLOBMSG_TYPE_BOOL },
	[DEV_CARRIER] = { .name = "carrier", .type = BLOBMSG_TYPE_BOOL },
};

int oledd_ubus_device_status(struct ubus_context *ctx, const char *device,
			     struct oledd_dev_status *st)
{
	struct blob_attr *reply = NULL;
	struct blob_attr *tb[__DEV_MAX];
	struct blob_buf b = {};
	int ret;

	if (!ctx || !device || !st)
		return -1;

	memset(st, 0, sizeof(*st));

	blob_buf_init(&b, 0);
	blobmsg_add_string(&b, "name", device);
	ret = ubus_invoke_simple(ctx, "network.device", "status", b.head,
				   &reply);
	blob_buf_free(&b);
	if (ret != 0)
		return -1;

	blobmsg_parse(dev_policy, __DEV_MAX, tb, blob_data(reply),
		      blob_len(reply));

	if (tb[DEV_UP])
		st->up = blobmsg_get_bool(tb[DEV_UP]);
	if (tb[DEV_CARRIER])
		st->carrier = blobmsg_get_bool(tb[DEV_CARRIER]);
	else if (tb[DEV_LINK])
		st->carrier = blobmsg_get_bool(tb[DEV_LINK]);

	free(reply);
	return 0;
}

enum {
	IF_UP,
	IF_IPV4,
	__IF_MAX,
};

static const struct blobmsg_policy if_policy[__IF_MAX] = {
	[IF_UP] = { .name = "up", .type = BLOBMSG_TYPE_BOOL },
	[IF_IPV4] = { .name = "ipv4-address", .type = BLOBMSG_TYPE_ARRAY },
};

enum {
	ADDR_ADDRESS,
	__ADDR_MAX,
};

static const struct blobmsg_policy addr_policy[__ADDR_MAX] = {
	[ADDR_ADDRESS] = { .name = "address", .type = BLOBMSG_TYPE_STRING },
};

int oledd_ubus_interface_up(struct ubus_context *ctx, const char *iface,
			    struct oledd_dev_status *st)
{
	char path[64];
	struct blob_attr *reply = NULL;
	struct blob_attr *tb[__IF_MAX];

	if (!ctx || !iface || !st)
		return -1;

	memset(st, 0, sizeof(*st));
	snprintf(path, sizeof(path), "network.interface.%s", iface);

	if (ubus_invoke_simple(ctx, path, "status", NULL, &reply) != 0)
		return -1;

	blobmsg_parse(if_policy, __IF_MAX, tb, blob_data(reply),
		      blob_len(reply));

	if (tb[IF_UP])
		st->up = blobmsg_get_bool(tb[IF_UP]);

	free(reply);
	return 0;
}

int oledd_ubus_interface_ipv4(struct ubus_context *ctx, const char *iface,
			      char *addr, size_t len)
{
	char path[64];
	struct blob_attr *reply = NULL;
	struct blob_attr *tb[__IF_MAX];
	struct blob_attr *cur;
	int rem;

	if (!ctx || !iface || !addr || len == 0)
		return -1;

	addr[0] = '\0';
	snprintf(path, sizeof(path), "network.interface.%s", iface);

	if (ubus_invoke_simple(ctx, path, "status", NULL, &reply) != 0)
		return -1;

	blobmsg_parse(if_policy, __IF_MAX, tb, blob_data(reply),
		      blob_len(reply));

	if (!tb[IF_IPV4]) {
		free(reply);
		return -1;
	}

	rem = blobmsg_data_len(tb[IF_IPV4]);
	blobmsg_for_each_attr(cur, tb[IF_IPV4], rem) {
		struct blob_attr *addr_tb[__ADDR_MAX];

		blobmsg_parse(addr_policy, __ADDR_MAX, addr_tb,
			      blobmsg_data(cur), blobmsg_data_len(cur));
		if (addr_tb[ADDR_ADDRESS]) {
			strncpy(addr, blobmsg_get_string(addr_tb[ADDR_ADDRESS]),
				len - 1);
			addr[len - 1] = '\0';
			free(reply);
			return 0;
		}
	}

	free(reply);
	return -1;
}

enum {
	AP_SSID,
	AP_NUM_STA,
	AP_CHANNEL,
	__AP_MAX,
};

static const struct blobmsg_policy ap_policy[__AP_MAX] = {
	[AP_SSID] = { .name = "ssid", .type = BLOBMSG_TYPE_STRING },
	[AP_NUM_STA] = { .name = "num_sta", .type = BLOBMSG_TYPE_INT32 },
	[AP_CHANNEL] = { .name = "channel", .type = BLOBMSG_TYPE_INT32 },
};

static int wifi_from_hostapd(struct ubus_context *ctx,
			     struct oledd_wifi_info *wifi)
{
	static const char *paths[] = { "hostapd.wlan0", "hostapd.wlan1" };
	struct blob_attr *reply = NULL;
	struct blob_attr *tb[__AP_MAX];
	unsigned int i;

	for (i = 0; i < sizeof(paths) / sizeof(paths[0]); i++) {
		free(reply);
		reply = NULL;
		if (ubus_invoke_simple(ctx, paths[i], "get_status", NULL,
				       &reply) != 0)
			continue;

		blobmsg_parse(ap_policy, __AP_MAX, tb, blob_data(reply),
			      blob_len(reply));
		if (!tb[AP_SSID])
			continue;

		strncpy(wifi->ssid, blobmsg_get_string(tb[AP_SSID]),
			sizeof(wifi->ssid) - 1);
		wifi->ssid[sizeof(wifi->ssid) - 1] = '\0';
		if (tb[AP_NUM_STA])
			wifi->num_sta = (int)blobmsg_get_u32(tb[AP_NUM_STA]);
		if (tb[AP_CHANNEL])
			snprintf(wifi->channel, sizeof(wifi->channel), "%u",
				 blobmsg_get_u32(tb[AP_CHANNEL]));
		wifi->valid = 1;
		free(reply);
		return 0;
	}

	free(reply);
	return -1;
}

enum {
	WL_IFACES,
	__WL_MAX,
};

static const struct blobmsg_policy wl_policy[__WL_MAX] = {
	[WL_IFACES] = { .name = "interfaces", .type = BLOBMSG_TYPE_ARRAY },
};

enum {
	WLI_SSID,
	WLI_UP,
	__WLI_MAX,
};

static const struct blobmsg_policy wli_policy[__WLI_MAX] = {
	[WLI_SSID] = { .name = "ssid", .type = BLOBMSG_TYPE_STRING },
	[WLI_UP] = { .name = "up", .type = BLOBMSG_TYPE_BOOL },
};

static int wifi_from_wireless(struct ubus_context *ctx,
			      struct oledd_wifi_info *wifi)
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

		blobmsg_parse(wli_policy, __WLI_MAX, itb, blobmsg_data(cur),
			      blobmsg_data_len(cur));
		if (itb[WLI_SSID]) {
			strncpy(wifi->ssid, blobmsg_get_string(itb[WLI_SSID]),
				sizeof(wifi->ssid) - 1);
			wifi->ssid[sizeof(wifi->ssid) - 1] = '\0';
			wifi->valid = 1;
			free(reply);
			return 0;
		}
	}

	free(reply);
	return -1;
}

int oledd_ubus_wifi_status(struct ubus_context *ctx,
			   struct oledd_wifi_info *wifi)
{
	if (!wifi)
		return -1;

	memset(wifi, 0, sizeof(*wifi));
	wifi->num_sta = -1;

	if (!ctx)
		return -1;

	if (wifi_from_hostapd(ctx, wifi) == 0)
		return 0;

	if (wifi_from_wireless(ctx, wifi) == 0)
		return 0;

	return -1;
}
