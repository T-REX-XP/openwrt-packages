/*
 * oledd_menu — menu list/detail views and auto-rotate mode (Phase 3).
 */

#include "oledd_menu.h"

#include <stdio.h>
#include <string.h>
#include <time.h>

#include "SSD1306_OLED.h"
#include "oledd_net.h"
#include "oledd_ubus.h"

#define STATE_FILE "/tmp/oled_state"
#define BOOT_DONE_STAGE "ready"

enum oled_view {
	VIEW_BOOT = 0,
	VIEW_SYSTEM,
	VIEW_PORTS,
	VIEW_WIFI,
	VIEW_COUNT
};

enum menu_item {
	ITEM_SYSTEM = 0,
	ITEM_PORTS,
	ITEM_WIFI,
	ITEM_BOOT,
	ITEM_MAX
};

enum screen_mode {
	SCREEN_BOOT = 0,
	SCREEN_ROTATE,
	SCREEN_MENU_LIST,
	SCREEN_MENU_DETAIL,
};

static struct ubus_context *g_ubus;
static int g_interactive = 1;
static int g_menu_wifi = 1;
static unsigned g_view_timeout = 5;

static enum screen_mode g_screen = SCREEN_BOOT;
static enum oled_view g_rotate_view = VIEW_SYSTEM;
static enum menu_item g_menu_sel = ITEM_SYSTEM;
static enum oled_view g_detail_view = VIEW_SYSTEM;
static time_t g_view_started;
static int g_item_count;
static enum menu_item g_visible_items[ITEM_MAX];

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
		return 0;
	return strcmp(stage, BOOT_DONE_STAGE) != 0;
}

static void rebuild_item_count(void)
{
	int n = 0;

	g_visible_items[n++] = ITEM_SYSTEM;
	g_visible_items[n++] = ITEM_PORTS;
	if (g_menu_wifi)
		g_visible_items[n++] = ITEM_WIFI;
	g_visible_items[n++] = ITEM_BOOT;
	g_item_count = n;
}

static enum menu_item nth_visible(int idx)
{
	if (idx < 0 || idx >= g_item_count)
		return ITEM_SYSTEM;
	return g_visible_items[idx];
}

static int visible_index(enum menu_item item)
{
	int i;

	for (i = 0; i < g_item_count; i++) {
		if (g_visible_items[i] == item)
			return i;
	}
	return 0;
}

static enum oled_view item_to_view(enum menu_item item)
{
	switch (item) {
	case ITEM_SYSTEM:
		return VIEW_SYSTEM;
	case ITEM_PORTS:
		return VIEW_PORTS;
	case ITEM_WIFI:
		return VIEW_WIFI;
	case ITEM_BOOT:
	default:
		return VIEW_BOOT;
	}
}

static const char *item_label(enum menu_item item)
{
	switch (item) {
	case ITEM_SYSTEM:
		return "System";
	case ITEM_PORTS:
		return "Ports";
	case ITEM_WIFI:
		return "WiFi";
	case ITEM_BOOT:
	default:
		return "Boot log";
	}
}

static enum menu_item next_item(enum menu_item cur, int delta)
{
	int idx = visible_index(cur) + delta;

	if (idx < 0)
		idx = g_item_count - 1;
	if (idx >= g_item_count)
		idx = 0;
	return nth_visible(idx);
}

static enum oled_view next_rotating_view(enum oled_view cur)
{
	enum oled_view v = cur;

	do {
		v = (enum oled_view)((v + 1) % VIEW_COUNT);
	} while (v == VIEW_BOOT || (v == VIEW_WIFI && !g_menu_wifi));
	return v;
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

static void draw_boot_view(void)
{
	char stage[32] = "boot";
	char message[64] = "BOOTING...";
	int progress = 25;

	draw_header("Boot");

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

static void draw_menu_list(void)
{
	int y = 14;
	int i;

	draw_header("Menu");

	for (i = 0; i < g_item_count; i++) {
		enum menu_item item = nth_visible(i);
		const char *prefix = (item == g_menu_sel) ? ">" : " ";

		setCursor(0, y);
		print_str((const unsigned char *)prefix);
		print_str((const unsigned char *)item_label(item));
		y += 12;
	}
}

static void draw_detail_view(enum oled_view view, double elapsed_sec)
{
	switch (view) {
	case VIEW_BOOT:
		draw_boot_view();
		break;
	case VIEW_SYSTEM:
		draw_system_view();
		break;
	case VIEW_PORTS:
		draw_ports_view(elapsed_sec);
		break;
	case VIEW_WIFI:
		draw_wifi_view();
		break;
	default:
		break;
	}
}

void oledd_menu_init(int interactive, int menu_wifi, unsigned view_timeout,
		     struct ubus_context *ubus)
{
	g_interactive = interactive;
	g_menu_wifi = menu_wifi;
	g_view_timeout = view_timeout;
	g_ubus = ubus;
	rebuild_item_count();
	g_screen = SCREEN_BOOT;
	g_rotate_view = VIEW_SYSTEM;
	g_menu_sel = ITEM_SYSTEM;
	g_detail_view = VIEW_SYSTEM;
	g_view_started = time(NULL);
}

void oledd_menu_set_ubus(struct ubus_context *ubus)
{
	g_ubus = ubus;
}

static void leave_boot(void)
{
	g_view_started = time(NULL);
	if (g_interactive) {
		g_screen = SCREEN_MENU_LIST;
		g_menu_sel = ITEM_SYSTEM;
	} else {
		g_screen = SCREEN_ROTATE;
		g_rotate_view = VIEW_SYSTEM;
	}
}

static void open_detail_for_selection(void)
{
	g_detail_view = item_to_view(g_menu_sel);
	g_screen = SCREEN_MENU_DETAIL;
}

static void handle_net_event(void)
{
	if (g_screen == SCREEN_BOOT)
		return;

	if (g_interactive) {
		g_menu_sel = ITEM_PORTS;
		g_detail_view = VIEW_PORTS;
		g_screen = SCREEN_MENU_DETAIL;
	} else {
		g_rotate_view = VIEW_PORTS;
		g_view_started = time(NULL);
	}
}

static void advance_rotate_view(void)
{
	g_rotate_view = next_rotating_view(g_rotate_view);
	g_view_started = time(NULL);
}

static void handle_interactive_event(oledd_event_t evt)
{
	switch (evt) {
	case OLEDD_EV_UP:
		if (g_screen == SCREEN_MENU_LIST)
			g_menu_sel = next_item(g_menu_sel, -1);
		break;
	case OLEDD_EV_DOWN:
		if (g_screen == SCREEN_MENU_LIST)
			g_menu_sel = next_item(g_menu_sel, 1);
		else if (g_screen == SCREEN_MENU_DETAIL)
			g_screen = SCREEN_MENU_LIST;
		break;
	case OLEDD_EV_NEXT:
		if (g_screen == SCREEN_MENU_LIST)
			g_menu_sel = next_item(g_menu_sel, 1);
		else if (g_screen == SCREEN_MENU_DETAIL) {
			g_detail_view = next_rotating_view(g_detail_view);
			g_view_started = time(NULL);
		}
		break;
	case OLEDD_EV_OK:
		if (g_screen == SCREEN_MENU_LIST)
			open_detail_for_selection();
		break;
	case OLEDD_EV_BACK:
		if (g_screen == SCREEN_MENU_DETAIL)
			g_screen = SCREEN_MENU_LIST;
		break;
	case OLEDD_EV_NET:
		handle_net_event();
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
			if (evt != OLEDD_EV_NONE)
				return 1;
			return 1;
		}
		leave_boot();
		redraw = 1;
	}

	if (evt != OLEDD_EV_NONE) {
		if (g_interactive)
			handle_interactive_event(evt);
		else if (evt == OLEDD_EV_NET)
			handle_net_event();
		else if (evt == OLEDD_EV_NEXT)
			advance_rotate_view();
		redraw = 1;
	}

	if (!g_interactive && g_screen == SCREEN_ROTATE &&
	    (unsigned)(now - g_view_started) >= g_view_timeout) {
		g_rotate_view = next_rotating_view(g_rotate_view);
		g_view_started = now;
		redraw = 1;
	}

	if (g_screen == SCREEN_BOOT)
		redraw = 1;

	return redraw;
}

void oledd_menu_render(double elapsed_sec)
{
	clearDisplay();

	switch (g_screen) {
	case SCREEN_BOOT:
		draw_boot_view();
		break;
	case SCREEN_ROTATE:
		draw_detail_view(g_rotate_view, elapsed_sec);
		break;
	case SCREEN_MENU_LIST:
		draw_menu_list();
		break;
	case SCREEN_MENU_DETAIL:
		draw_detail_view(g_detail_view, elapsed_sec);
		break;
	}

	Display();
}
