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
#include "oledd_net.h"
#include "oledd_pages.h"
#include "oledd_ubus.h"

#define STATE_FILE "/tmp/oled_state"
#define BOOT_DONE_STAGE "ready"
#define BOOT_NETWORK_STAGE "network"
#define BOOT_TIMEOUT_SEC 20

#define HEADER_Y 10
#define ALERT_TOP 54

enum legacy_view {
	LEGACY_SYSTEM = 0,
	LEGACY_PORTS,
	LEGACY_WIFI,
	LEGACY_COUNT,
};

enum screen_mode {
	SCREEN_BOOT = 0,
	SCREEN_PAGES,
	SCREEN_LEGACY,
};

static struct ubus_context *g_ubus;
static int g_interactive = 1;
static int g_menu_wifi = 1;
static unsigned g_view_timeout = 5;
static unsigned g_idle_dim_sec;

static enum screen_mode g_screen = SCREEN_BOOT;
static int g_page_idx;
static enum legacy_view g_legacy_view = LEGACY_SYSTEM;
static time_t g_view_started;
static time_t g_last_activity;
static time_t g_boot_started;
static int g_dimmed;
static int g_pages_ok;

static void leave_boot(void);

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
	if (!strcmp(stage, BOOT_DONE_STAGE))
		return 0;
	if (!strcmp(stage, BOOT_NETWORK_STAGE))
		return 0;
	return 1;
}

static const char *legacy_view_name(enum legacy_view view)
{
	switch (view) {
	case LEGACY_PORTS:
		return "ports";
	case LEGACY_WIFI:
		return "wifi";
	case LEGACY_SYSTEM:
	default:
		return "system";
	}
}

static enum legacy_view next_legacy_view(enum legacy_view cur)
{
	enum legacy_view v = cur;

	do {
		v = (enum legacy_view)((v + 1) % LEGACY_COUNT);
	} while (v == LEGACY_WIFI && !g_menu_wifi);
	return v;
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

static void legacy_next(int delta)
{
	int i;
	enum legacy_view v = g_legacy_view;

	for (i = 0; i < LEGACY_COUNT; i++) {
		v = (enum legacy_view)((v + delta + LEGACY_COUNT) % LEGACY_COUNT);
		if (v != LEGACY_WIFI || g_menu_wifi)
			break;
	}
	g_legacy_view = v;
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
		else if (!strcmp(stage, BOOT_NETWORK_STAGE))
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

static void draw_header(const char *title)
{
	setTextSize(1);
	setTextColor(WHITE);
	setCursor(0, 0);
	print_str((const unsigned char *)title);
	drawLine(0, 10, oled_lcd_width() - 1, 10, WHITE);
}

static void format_uptime(unsigned long sec, char *out, size_t len)
{
	unsigned long d = sec / 86400;
	unsigned long h = (sec % 86400) / 3600;
	unsigned long m = (sec % 3600) / 60;

	if (d > 0)
		snprintf(out, len, "%lud %02luh", d, h);
	else
		snprintf(out, len, "%02lu:%02lu", h, m);
}

static void draw_system_view(void)
{
	struct oledd_system_info info;
	char upbuf[24];
	unsigned long mem_used_mb;

	draw_header("System");

	if (!g_ubus || oledd_ubus_system_info(g_ubus, &info) != 0) {
		setCursor(0, 16);
		print_str((const unsigned char *)"ubus unavailable");
		return;
	}

	format_uptime(info.uptime, upbuf, sizeof(upbuf));
	mem_used_mb = info.mem_total > info.mem_free ?
	    (info.mem_total - info.mem_free) / 1024 : 0;

	setCursor(0, 14);
	print_str((const unsigned char *)"Up: ");
	print_str((const unsigned char *)upbuf);

	setCursor(0, 26);
	print_str((const unsigned char *)"Load: ");
	printFloat((double)info.load1, 2);

	setCursor(0, 38);
	print_str((const unsigned char *)"RAM: ");
	printNumber_UI((unsigned int)mem_used_mb, DEC);
	print_str((const unsigned char *)"M used");
}

static void draw_rate_bar(int x, int y, int w, int h, double mbps)
{
	int fill;

	fillRect(x, y, w, h, BLACK);
	if (mbps <= 0.0)
		return;

	fill = (int)((mbps / OLEDD_BAR_MAX_MBPS) * (double)w);
	if (fill < 1 && mbps > 0.01)
		fill = 1;
	if (fill > w)
		fill = w;
	fillRect(x, y, fill, h, WHITE);
}

static void draw_ports_view(double elapsed_sec)
{
	struct oledd_port_status ports[OLEDD_PORT_MAX];
	char line[24];
	int count, i, y = 14;
	int bar_w = oled_lcd_width() - 4;
	const int row_h = 16;

	draw_header("Ports");

	count = oledd_net_poll_ports(g_ubus, ports, OLEDD_PORT_MAX, elapsed_sec);

	for (i = 0; i < count; i++) {
		const struct oledd_port_status *p = &ports[i];
		const char *link = p->carrier ? "UP" : (p->up ? "up" : "dn");

		if (p->ipv4[0])
			snprintf(line, sizeof(line), "%.5s %-2s %.10s", p->device,
				 link, p->ipv4);
		else
			snprintf(line, sizeof(line), "%.8s %-3s", p->device, link);

		setCursor(0, y);
		print_str((const unsigned char *)line);

		draw_rate_bar(2, y + 9, bar_w, 3,
			      p->rx_mbps > p->tx_mbps ? p->rx_mbps : p->tx_mbps);

		y += row_h;
	}
}

static void draw_wifi_view(void)
{
	struct oledd_wifi_info wifi;

	draw_header("WiFi");

	if (!g_ubus || oledd_ubus_wifi_status(g_ubus, &wifi) != 0 ||
	    !wifi.valid) {
		setCursor(0, 18);
		print_str((const unsigned char *)"WiFi N/A");
		return;
	}

	setCursor(0, 14);
	print_str((const unsigned char *)wifi.ssid);

	if (wifi.num_sta >= 0) {
		setCursor(0, 28);
		print_str((const unsigned char *)"Clients: ");
		printNumber_UI((unsigned int)wifi.num_sta, DEC);
	}

	if (wifi.channel[0]) {
		setCursor(0, 40);
		print_str((const unsigned char *)"Ch: ");
		print_str((const unsigned char *)wifi.channel);
	}
}

static void draw_legacy_view(enum legacy_view view, double elapsed_sec)
{
	switch (view) {
	case LEGACY_PORTS:
		draw_ports_view(elapsed_sec);
		break;
	case LEGACY_WIFI:
		draw_wifi_view();
		break;
	case LEGACY_SYSTEM:
	default:
		draw_system_view();
		break;
	}
}

void oledd_menu_init(int interactive, int menu_wifi, unsigned view_timeout,
		     unsigned idle_dim_sec, struct ubus_context *ubus)
{
	char pages_path[128];

	g_interactive = interactive;
	g_menu_wifi = menu_wifi;
	g_view_timeout = view_timeout;
	g_idle_dim_sec = idle_dim_sec;
	g_ubus = ubus;
	g_screen = SCREEN_BOOT;
	g_page_idx = 0;
	g_legacy_view = LEGACY_SYSTEM;
	g_view_started = time(NULL);
	g_last_activity = g_view_started;
	g_boot_started = g_view_started;
	g_dimmed = 0;
	g_pages_ok = 0;

	oledd_config_menu_pages_path(pages_path, sizeof(pages_path));
	if (oledd_pages_load(pages_path) == 0)
		g_pages_ok = 1;
	else
		syslog(LOG_WARNING,
		       "OLED pages config failed (%s) — using legacy views",
		       pages_path);

	if (!boot_active())
		leave_boot();
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
	if (g_screen == SCREEN_LEGACY)
		return legacy_view_name(g_legacy_view);
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
	if (idx >= 0) {
		g_screen = SCREEN_PAGES;
		g_page_idx = idx;
		g_view_started = time(NULL);
		oledd_menu_wake();
		return 1;
	}

	if (!strcmp(view, "system")) {
		g_screen = SCREEN_LEGACY;
		g_legacy_view = LEGACY_SYSTEM;
		g_view_started = time(NULL);
		oledd_menu_wake();
		return 1;
	}
	if (!strcmp(view, "ports")) {
		g_screen = SCREEN_LEGACY;
		g_legacy_view = LEGACY_PORTS;
		g_view_started = time(NULL);
		oledd_menu_wake();
		return 1;
	}
	if (!strcmp(view, "wifi") && g_menu_wifi) {
		g_screen = SCREEN_LEGACY;
		g_legacy_view = LEGACY_WIFI;
		g_view_started = time(NULL);
		oledd_menu_wake();
		return 1;
	}

	return 0;
}

static void leave_boot(void)
{
	g_view_started = time(NULL);
	oledd_menu_wake();
	if (g_pages_ok && oledd_pages_count() > 0) {
		g_screen = SCREEN_PAGES;
		g_page_idx = 0;
		syslog(LOG_INFO, "boot complete — page dashboard");
	} else {
		g_screen = SCREEN_LEGACY;
		g_legacy_view = LEGACY_SYSTEM;
		syslog(LOG_INFO, "boot complete — legacy views");
	}
}

static void handle_page_event(oledd_event_t evt)
{
	switch (evt) {
	case OLEDD_EV_UP:
	case OLEDD_EV_BACK:
		if (g_screen == SCREEN_LEGACY)
			legacy_next(-1);
		else
			page_next(-1);
		break;
	case OLEDD_EV_DOWN:
	case OLEDD_EV_NEXT:
		if (g_screen == SCREEN_LEGACY)
			legacy_next(1);
		else
			page_next(1);
		break;
	case OLEDD_EV_OK:
		if (g_screen == SCREEN_LEGACY)
			legacy_next(1);
		else
			page_next(1);
		break;
	case OLEDD_EV_NET:
		if (g_screen == SCREEN_LEGACY) {
			g_legacy_view = LEGACY_PORTS;
			g_view_started = time(NULL);
		} else {
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
	int evt_handled = 0;

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
				leave_boot();
				handle_page_event(evt);
				evt_handled = 1;
				redraw = 1;
			} else {
				return 1;
			}
		} else {
			leave_boot();
			redraw = 1;
		}
	}

	if (evt != OLEDD_EV_NONE && !evt_handled) {
		oledd_menu_wake();
		handle_page_event(evt);
		redraw = 1;
	}

	if (!g_interactive && g_screen != SCREEN_BOOT &&
	    (unsigned)(now - g_view_started) >= g_view_timeout) {
		if (g_screen == SCREEN_PAGES && oledd_pages_count() > 1)
			page_next(1);
		else if (g_screen == SCREEN_LEGACY)
			g_legacy_view = next_legacy_view(g_legacy_view);
		g_view_started = now;
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
	case SCREEN_LEGACY:
		draw_legacy_view(g_legacy_view, elapsed_sec);
		break;
	}

	oledd_alert_draw();
	if (Display() != 0)
		syslog(LOG_WARNING, "display flush failed (view=%s)", view);
}
