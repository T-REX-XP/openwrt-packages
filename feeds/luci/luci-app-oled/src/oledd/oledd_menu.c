/*
 * oledd_menu — boot splash + config-driven page dashboard (router OLED spec).
 */

#include "oledd_menu.h"

#include <stdio.h>
#include <string.h>
#include <syslog.h>
#include <time.h>

#include "SSD1306_OLED.h"
#include "oledd_alert.h"
#include "oledd_config.h"
#include "oledd_pages.h"

#define STATE_FILE "/tmp/oled_state"
#define BOOT_DONE_STAGE "ready"
#define BOOT_TIMEOUT_SEC 45

#define HEADER_Y 10
#define ALERT_TOP 54

enum screen_mode {
	SCREEN_BOOT = 0,
	SCREEN_PAGES,
};

static struct ubus_context *g_ubus;
static int g_interactive = 1;
static unsigned g_view_timeout = 5;
static unsigned g_idle_dim_sec;

static enum screen_mode g_screen = SCREEN_BOOT;
static int g_page_idx;
static time_t g_view_started;
static time_t g_last_activity;
static time_t g_boot_started;
static int g_dimmed;

static int parse_state_kv(const char *key, char *val, size_t len)
{
	char line[128];
	FILE *f = fopen(STATE_FILE, "r");

	if (!f)
		return -1;
	while (fgets(line, sizeof(line), f)) {
		char *eq = strchr(line, '=');

		if (!eq)
			continue;
		*eq = '\0';
		if (strcmp(line, key) != 0)
			continue;
		strncpy(val, eq + 1, len - 1);
		val[len - 1] = '\0';
		val[strcspn(val, "\r\n")] = '\0';
		fclose(f);
		return 0;
	}
	fclose(f);
	return -1;
}

static int boot_active(void)
{
	char stage[32];

	if (parse_state_kv("stage", stage, sizeof(stage)) != 0)
		return 1;
	return strcmp(stage, BOOT_DONE_STAGE) != 0;
}

static void page_next(int delta)
{
	int count = oledd_pages_count();

	if (count <= 0)
		return;
	g_page_idx += delta;
	if (g_page_idx < 0)
		g_page_idx = count - 1;
	if (g_page_idx >= count)
		g_page_idx = 0;
	g_view_started = time(NULL);
}

static void draw_boot_view(void)
{
	char stage[32] = "boot";
	char message[64] = "BOOTING...";
	int progress = 25;

	setTextSize(1);
	setTextColor(WHITE);
	setCursor(0, 0);
	print_str((const unsigned char *)"Boot");
	drawLine(0, HEADER_Y, oled_lcd_width() - 1, HEADER_Y, WHITE);

	if (parse_state_kv("stage", stage, sizeof(stage)) == 0) {
		if (!strcmp(stage, "preinit"))
			progress = 10;
		else if (!strcmp(stage, "boot"))
			progress = 35;
		else if (!strcmp(stage, "network"))
			progress = 65;
		else if (!strcmp(stage, BOOT_DONE_STAGE))
			progress = 100;
	}
	if (parse_state_kv("message", message, sizeof(message)) != 0)
		strncpy(message, "BOOTING...", sizeof(message));

	setCursor(0, 16);
	setTextSize(1);
	print_str((const unsigned char *)message);

	fillRect(0, 40, oled_lcd_width(), 8, BLACK);
	fillRect(0, 40, (oled_lcd_width() * progress) / 100, 8, WHITE);
	setCursor(0, 52);
	print_str((const unsigned char *)stage);
}

void oledd_menu_init(int interactive, int menu_wifi, unsigned view_timeout,
		     unsigned idle_dim_sec, struct ubus_context *ubus)
{
	char pages_path[128];

	(void)menu_wifi;
	g_interactive = interactive;
	g_view_timeout = view_timeout;
	g_idle_dim_sec = idle_dim_sec;
	g_ubus = ubus;
	g_screen = SCREEN_BOOT;
	g_page_idx = 0;
	g_view_started = time(NULL);
	g_last_activity = g_view_started;
	g_boot_started = g_view_started;
	g_dimmed = 0;

	oledd_config_menu_pages_path(pages_path, sizeof(pages_path));
	if (oledd_pages_load(pages_path) != 0)
		syslog(LOG_WARNING, "OLED pages config failed — dashboard disabled");
}

void oledd_menu_set_ubus(struct ubus_context *ubus)
{
	g_ubus = ubus;
}

void oledd_menu_wake(void)
{
	g_last_activity = time(NULL);
	g_dimmed = 0;
}

int oledd_menu_is_dimmed(void)
{
	return g_dimmed;
}

void oledd_menu_check_idle(void)
{
	time_t now = time(NULL);

	if (!g_idle_dim_sec || !g_interactive)
		return;
	if (g_screen == SCREEN_BOOT)
		return;

	if ((unsigned)(now - g_last_activity) >= g_idle_dim_sec) {
		if (!g_dimmed)
			syslog(LOG_INFO, "idle dim after %us (view=%s)",
			       g_idle_dim_sec, oledd_menu_view_name());
		g_dimmed = 1;
	}
}

const char *oledd_menu_view_name(void)
{
	if (g_screen == SCREEN_BOOT)
		return "boot";
	if (oledd_pages_count() <= 0)
		return "pages";
	return oledd_pages_id(g_page_idx);
}

int oledd_menu_set_view(const char *view)
{
	int idx;

	if (!view || !view[0])
		return 0;

	if (!strcmp(view, "boot")) {
		g_screen = SCREEN_BOOT;
		g_view_started = time(NULL);
		g_boot_started = g_view_started;
		oledd_menu_wake();
		return 1;
	}

	idx = oledd_pages_index_by_id(view);
	if (idx < 0)
		return 0;

	g_screen = SCREEN_PAGES;
	g_page_idx = idx;
	g_view_started = time(NULL);
	oledd_menu_wake();
	return 1;
}

static void leave_boot(void)
{
	g_screen = SCREEN_PAGES;
	g_page_idx = 0;
	g_view_started = time(NULL);
	oledd_menu_wake();
	syslog(LOG_INFO, "boot complete — page dashboard");
}

static void handle_page_event(oledd_event_t evt)
{
	switch (evt) {
	case OLEDD_EV_UP:
	case OLEDD_EV_BACK:
		page_next(-1);
		break;
	case OLEDD_EV_DOWN:
	case OLEDD_EV_NEXT:
		page_next(1);
		break;
	case OLEDD_EV_OK:
		page_next(1);
		break;
	case OLEDD_EV_NET:
	{
		int idx = oledd_pages_index_by_id("network");

		if (idx >= 0) {
			g_screen = SCREEN_PAGES;
			g_page_idx = idx;
			g_view_started = time(NULL);
		}
	}
		break;
	case OLEDD_EV_REFRESH:
		break;
	default:
		break;
	}
}

int oledd_menu_tick(double elapsed_sec, oledd_event_t evt)
{
	time_t now = time(NULL);
	int redraw = 0;

	(void)elapsed_sec;

	if (g_screen == SCREEN_BOOT) {
		if (boot_active()) {
			if ((unsigned)(now - g_boot_started) >= BOOT_TIMEOUT_SEC) {
				syslog(LOG_WARNING,
				       "boot timeout (%us) — leaving splash",
				       BOOT_TIMEOUT_SEC);
				leave_boot();
				redraw = 1;
			} else if (evt != OLEDD_EV_NONE) {
				return 1;
			} else {
				return 1;
			}
		} else {
			leave_boot();
			redraw = 1;
		}
	}

	if (evt != OLEDD_EV_NONE) {
		oledd_menu_wake();
		handle_page_event(evt);
		redraw = 1;
	}

	if (!g_interactive && g_screen == SCREEN_PAGES &&
	    oledd_pages_count() > 1 &&
	    (unsigned)(now - g_view_started) >= g_view_timeout) {
		page_next(1);
		redraw = 1;
	}

	if (g_screen == SCREEN_BOOT)
		redraw = 1;

	return redraw;
}

void oledd_menu_render(double elapsed_sec)
{
	const char *view = oledd_menu_view_name();

	if (g_dimmed) {
		clearDisplay();
		if (Display() != 0)
			syslog(LOG_WARNING, "display flush failed (dim, view=%s)",
			       view);
		return;
	}

	clearDisplay();

	switch (g_screen) {
	case SCREEN_BOOT:
		draw_boot_view();
		break;
	case SCREEN_PAGES:
		if (oledd_pages_count() > 0)
			oledd_pages_render(g_page_idx, g_ubus, elapsed_sec);
		else {
			setCursor(0, 20);
			setTextSize(1);
			print_str((const unsigned char *)"No pages config");
		}
		break;
	}

	oledd_alert_draw();
	if (Display() != 0)
		syslog(LOG_WARNING, "display flush failed (view=%s)", view);
}
