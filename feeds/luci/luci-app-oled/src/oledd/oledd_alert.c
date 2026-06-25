/*
 * oledd_alert — WAN down / high load banners (Phase 4).
 */

#include "oledd_alert.h"

#include <stdio.h>
#include <string.h>

#include "SSD1306_OLED.h"
#include "oledd_ubus.h"

#define LOAD_ALERT_THRESHOLD 2.0f

static int g_enabled = 1;
static int g_wan_down;
static int g_high_load;

static int eth0_operstate_down(void)
{
	char state[16];
	FILE *f;

	f = fopen("/sys/class/net/eth0/operstate", "r");
	if (!f)
		return 0;

	if (!fgets(state, sizeof(state), f)) {
		fclose(f);
		return 0;
	}
	fclose(f);

	return strncmp(state, "down", 4) == 0;
}

void oledd_alert_init(int enabled)
{
	g_enabled = enabled;
	g_wan_down = 0;
	g_high_load = 0;
}

void oledd_alert_poll(struct ubus_context *ctx)
{
	struct oledd_system_info info;
	struct oledd_dev_status wan;
	int iface_down = 0;

	if (!g_enabled) {
		g_wan_down = 0;
		g_high_load = 0;
		return;
	}

	if (ctx && oledd_ubus_interface_up(ctx, "wan", &wan) == 0)
		iface_down = !wan.up;

	g_wan_down = eth0_operstate_down() || iface_down;

	g_high_load = 0;
	if (ctx && oledd_ubus_system_info(ctx, &info) == 0)
		g_high_load = info.load1 > LOAD_ALERT_THRESHOLD;
}

void oledd_alert_draw(void)
{
	const char *msg = NULL;

	if (!g_enabled)
		return;

	if (g_wan_down)
		msg = "! WAN down";
	else if (g_high_load)
		msg = "! High load";

	if (!msg)
		return;

	fillRect(0, 54, oled_lcd_width(), 10, WHITE);
	setTextSize(1);
	setTextColor(BLACK);
	setCursor(2, 56);
	print_str((const unsigned char *)msg);
}
