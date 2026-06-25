/*
 * oledd_ubus_srv — ubus control object for oledd (Phase 4).
 */

#include "oledd_ubus_srv.h"

#include <stdio.h>
#include <string.h>

#include <libubus.h>
#include <libubox/blobmsg.h>
#include <libubox/uloop.h>
#include <libubox/utils.h>

#include "oledd_input.h"
#include "oledd_menu.h"

static char g_i2c_path[32] = "/dev/i2c-7";
static int g_menu_interactive = 1;

static int read_boot_stage(char *stage, size_t len)
{
	char line[128];
	FILE *f;

	if (!stage || !len)
		return -1;

	stage[0] = '\0';
	f = fopen("/tmp/oled_state", "r");
	if (!f)
		return -1;

	while (fgets(line, sizeof(line), f)) {
		char *eq = strchr(line, '=');

		if (!eq || strncmp(line, "stage=", 6) != 0)
			continue;
		strncpy(stage, eq + 1, len - 1);
		stage[len - 1] = '\0';
		stage[strcspn(stage, "\r\n")] = '\0';
		fclose(f);
		return 0;
	}

	fclose(f);
	return -1;
}

static int oledd_ubus_status(struct ubus_context *ctx, struct ubus_object *obj,
			     struct ubus_request_data *req, const char *method,
			     struct blob_attr *msg)
{
	struct blob_buf b = {};
	char stage[32] = "boot";

	(void)ctx;
	(void)obj;
	(void)method;
	(void)msg;

	read_boot_stage(stage, sizeof(stage));

	blob_buf_init(&b, 0);
	blobmsg_add_u8(&b, "running", 1);
	blobmsg_add_string(&b, "view", oledd_menu_view_name());
	blobmsg_add_string(&b, "boot_stage", stage);
	blobmsg_add_string(&b, "i2c", g_i2c_path);
	blobmsg_add_u8(&b, "menu_interactive", g_menu_interactive ? 1 : 0);
	blobmsg_add_u8(&b, "dimmed", oledd_menu_is_dimmed() ? 1 : 0);
	ubus_send_reply(ctx, req, b.head);
	blob_buf_free(&b);
	return 0;
}

enum {
	EV_TYPE,
	__EV_MAX,
};

static const struct blobmsg_policy event_policy[__EV_MAX] = {
	[EV_TYPE] = { .name = "type", .type = BLOBMSG_TYPE_STRING },
};

static int oledd_ubus_event(struct ubus_context *ctx, struct ubus_object *obj,
			    struct ubus_request_data *req, const char *method,
			    struct blob_attr *msg)
{
	struct blob_attr *tb[__EV_MAX];
	struct blob_buf b = {};
	const char *type;
	int ok = 0;

	(void)ctx;
	(void)obj;
	(void)method;

	blobmsg_parse(event_policy, __EV_MAX, tb, blob_data(msg), blob_len(msg));
	if (!tb[EV_TYPE])
		return UBUS_STATUS_INVALID_ARGUMENT;

	type = blobmsg_get_string(tb[EV_TYPE]);
	ok = oledd_input_push(type) != OLEDD_EV_NONE;
	if (ok)
		oledd_menu_wake();

	blob_buf_init(&b, 0);
	blobmsg_add_u8(&b, "ok", ok ? 1 : 0);
	ubus_send_reply(ctx, req, b.head);
	blob_buf_free(&b);
	return ok ? 0 : UBUS_STATUS_INVALID_ARGUMENT;
}

enum {
	SV_VIEW,
	__SV_MAX,
};

static const struct blobmsg_policy set_view_policy[__SV_MAX] = {
	[SV_VIEW] = { .name = "view", .type = BLOBMSG_TYPE_STRING },
};

static int oledd_ubus_set_view(struct ubus_context *ctx, struct ubus_object *obj,
			       struct ubus_request_data *req, const char *method,
			       struct blob_attr *msg)
{
	struct blob_attr *tb[__SV_MAX];
	struct blob_buf b = {};
	const char *view;
	int ok;

	(void)ctx;
	(void)obj;
	(void)method;

	blobmsg_parse(set_view_policy, __SV_MAX, tb, blob_data(msg),
		      blob_len(msg));
	if (!tb[SV_VIEW])
		return UBUS_STATUS_INVALID_ARGUMENT;

	view = blobmsg_get_string(tb[SV_VIEW]);
	ok = oledd_menu_set_view(view);
	if (ok)
		oledd_menu_wake();

	blob_buf_init(&b, 0);
	blobmsg_add_u8(&b, "ok", ok ? 1 : 0);
	ubus_send_reply(ctx, req, b.head);
	blob_buf_free(&b);
	return ok ? 0 : UBUS_STATUS_INVALID_ARGUMENT;
}

static const struct ubus_method oledd_methods[] = {
	UBUS_METHOD_NOARG("status", oledd_ubus_status),
	UBUS_METHOD("event", oledd_ubus_event, event_policy),
	UBUS_METHOD("set_view", oledd_ubus_set_view, set_view_policy),
};

static struct ubus_object_type g_obj_type =
	UBUS_OBJECT_TYPE("oledd", oledd_methods);
static struct ubus_object g_obj = {
	.name = "oledd",
	.type = &g_obj_type,
	.methods = oledd_methods,
	.n_methods = ARRAY_SIZE(oledd_methods),
};

int oledd_ubus_srv_register(struct ubus_context *ctx, const char *i2c_path,
			    int menu_interactive)
{
	if (!ctx)
		return -1;

	g_menu_interactive = menu_interactive;
	if (i2c_path)
		strncpy(g_i2c_path, i2c_path, sizeof(g_i2c_path) - 1);

	return ubus_add_object(ctx, &g_obj);
}

void oledd_ubus_srv_poll(struct ubus_context *ctx)
{
	if (ctx)
		uloop_run_timeout(10);
}

void oledd_ubus_srv_unregister(struct ubus_context *ctx)
{
	if (ctx && g_obj.id)
		ubus_remove_object(ctx, &g_obj);
}
