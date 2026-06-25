/*
 * oledd — OLED menu daemon (SH1106 128×64).
 * Phase 2: libubus metrics, network.device/interface, bandwidth bars, WiFi stub.
 */

#include <getopt.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "I2C.h"
#include "SSD1306_OLED.h"
#include "oledd_config.h"
#include "oledd_net.h"
#include "oledd_ubus.h"

#define STATE_FILE "/tmp/oled_state"
#define NET_TICK_FILE "/tmp/oled_net_changed"
#define POLL_MS_DEFAULT 800
#define VIEW_TIMEOUT_DEFAULT 5
#define BOOT_DONE_STAGE "ready"

enum oled_view {
	VIEW_BOOT = 0,
	VIEW_SYSTEM,
	VIEW_PORTS,
	VIEW_WIFI,
	VIEW_COUNT
};

static const struct oledd_port_entry cm5_ports[] = {
	{ "eth0", "wan" },
	{ "eth1", NULL },
	{ "br-lan", "lan" },
};

static volatile sig_atomic_t g_stop;
static char g_i2c_path[32] = I2C_DEV0_PATH;
static int g_rotate;
static int g_menu_wifi = 1;
static unsigned g_poll_ms = POLL_MS_DEFAULT;
static unsigned g_view_timeout = VIEW_TIMEOUT_DEFAULT;
static struct timespec g_last_poll;
static struct ubus_context *g_ubus;

static void on_signal(int sig)
{
	(void)sig;
	g_stop = 1;
}

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

static int boot_active(void)
{
	char stage[32];

	if (parse_state_kv("stage", stage, sizeof(stage)) != 0)
		return 0;
	return strcmp(stage, BOOT_DONE_STAGE) != 0;
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

	if (!g_ubus ||
	    oledd_ubus_system_info(g_ubus, &info) != 0) {
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

static void render_view(enum oled_view view, double elapsed_sec)
{
	clearDisplay();
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
	Display();
}

static void show_splash(void)
{
	clearDisplay();
	setTextSize(2);
	setTextColor(WHITE);
	setCursor(4, 20);
	print_str((const unsigned char *)"BOOTING...");
	Display();
	usleep(400000);
}

static double poll_elapsed(void)
{
	struct timespec now;
	double elapsed = 0.0;

	clock_gettime(CLOCK_MONOTONIC, &now);
	if (g_last_poll.tv_sec || g_last_poll.tv_nsec) {
		elapsed = (double)(now.tv_sec - g_last_poll.tv_sec) +
		    (double)(now.tv_nsec - g_last_poll.tv_nsec) / 1e9;
	}
	g_last_poll = now;
	return elapsed;
}

static void usage(const char *prog)
{
	fprintf(stderr,
		"Usage: %s [options]\n"
		"  -d, --i2cDevPath=PATH   I2C device (default %s)\n"
		"  -H, --rotate            180° rotation\n"
		"  -l, --poll-ms=MS        refresh interval (default %u)\n"
		"  -t, --view-timeout=SEC  seconds per view (default %u)\n"
		"  -h, --help              show help\n",
		prog, g_i2c_path, g_poll_ms, g_view_timeout);
}

int main(int argc, char *argv[])
{
	enum oled_view view = VIEW_BOOT;
	time_t view_started = 0;
	time_t now;
	int in_boot = 1;

	static struct option long_opts[] = {
		{ "i2cDevPath", required_argument, 0, 'd' },
		{ "rotate", no_argument, 0, 'H' },
		{ "poll-ms", required_argument, 0, 'l' },
		{ "view-timeout", required_argument, 0, 't' },
		{ "help", no_argument, 0, 'h' },
		{ 0, 0, 0, 0 },
	};

	signal(SIGINT, on_signal);
	signal(SIGTERM, on_signal);

	while (1) {
		int c = getopt_long(argc, argv, "d:Hl:t:h", long_opts, NULL);

		if (c == -1)
			break;
		switch (c) {
		case 'd':
			strncpy(g_i2c_path, optarg, sizeof(g_i2c_path) - 1);
			break;
		case 'H':
			g_rotate = 1;
			break;
		case 'l':
			g_poll_ms = (unsigned)atoi(optarg);
			break;
		case 't':
			g_view_timeout = (unsigned)atoi(optarg);
			break;
		case 'h':
			usage(argv[0]);
			return EXIT_SUCCESS;
		default:
			usage(argv[0]);
			return EXIT_FAILURE;
		}
	}

	g_menu_wifi = oledd_config_menu_wifi();
	oledd_net_ports_init(cm5_ports,
			     (int)(sizeof(cm5_ports) / sizeof(cm5_ports[0])));

	if (init_i2c_dev(g_i2c_path, SSD1306_OLED_ADDR) != 0) {
		fprintf(stderr, "oledd: I2C init failed on %s\n", g_i2c_path);
		return EXIT_FAILURE;
	}

	display_Init_seq();
	if (g_rotate)
		display_rotate();
	else
		display_normal();

	g_ubus = oledd_ubus_open();

	show_splash();

	view_started = time(NULL);
	memset(&g_last_poll, 0, sizeof(g_last_poll));
	render_view(VIEW_BOOT, 0.0);

	while (!g_stop) {
		int force_redraw = 0;
		struct stat st;
		double elapsed = poll_elapsed();

		if (stat(NET_TICK_FILE, &st) == 0) {
			unlink(NET_TICK_FILE);
			force_redraw = 1;
			if (!in_boot)
				view = VIEW_PORTS;
		}

		if (!g_ubus)
			g_ubus = oledd_ubus_open();

		now = time(NULL);
		if (in_boot) {
			if (!boot_active()) {
				in_boot = 0;
				view = VIEW_SYSTEM;
				view_started = now;
			}
		} else if ((unsigned)(now - view_started) >= g_view_timeout) {
			view = next_rotating_view(view);
			view_started = now;
			force_redraw = 1;
		}

		if (force_redraw || in_boot)
			render_view(in_boot ? VIEW_BOOT : view, elapsed);

		usleep(g_poll_ms * 1000);
	}

	oledd_ubus_close(g_ubus);
	g_ubus = NULL;
	clearDisplay();
	Display();
	return EXIT_SUCCESS;
}
