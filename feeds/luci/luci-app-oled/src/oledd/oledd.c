/*
 * oledd — OLED menu daemon (SH1106 128×64).
 * Phase 3: FIFO input, interactive menu, CM5 button hotplug.
 */

#include <getopt.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "I2C.h"
#include "SSD1306_OLED.h"
#include "oledd_config.h"
#include "oledd_input.h"
#include "oledd_menu.h"
#include "oledd_net.h"
#include "oledd_ubus.h"

#define POLL_MS_DEFAULT 800
#define VIEW_TIMEOUT_DEFAULT 5

static const struct oledd_port_entry cm5_ports[] = {
	{ "eth0", "wan" },
	{ "eth1", NULL },
	{ "br-lan", "lan" },
};

static volatile sig_atomic_t g_stop;
static char g_i2c_path[32] = I2C_DEV0_PATH;
static int g_rotate;
static int g_menu_wifi = 1;
static int g_menu_interactive = 1;
static unsigned g_poll_ms = POLL_MS_DEFAULT;
static unsigned g_view_timeout = VIEW_TIMEOUT_DEFAULT;
static struct timespec g_last_poll;
static struct ubus_context *g_ubus;

static void on_signal(int sig)
{
	(void)sig;
	g_stop = 1;
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
		"  -t, --view-timeout=SEC  seconds per view in auto-rotate mode (default %u)\n"
		"  -h, --help              show help\n",
		prog, g_i2c_path, g_poll_ms, g_view_timeout);
}

int main(int argc, char *argv[])
{
	oledd_event_t evt = OLEDD_EV_NONE;
	char nav_btn[32];
	char sel_btn[32];

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
	g_menu_interactive = oledd_config_menu_interactive();
	oledd_config_menu_nav_button(nav_btn, sizeof(nav_btn));
	oledd_config_menu_select_button(sel_btn, sizeof(sel_btn));
	fprintf(stderr, "oledd: nav_button=%s select_button=%s interactive=%d\n",
		nav_btn, sel_btn, g_menu_interactive);

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
	oledd_input_init();
	oledd_menu_init(g_menu_interactive, g_menu_wifi, g_view_timeout, g_ubus);

	show_splash();
	memset(&g_last_poll, 0, sizeof(g_last_poll));
	oledd_menu_render(0.0);

	while (!g_stop) {
		double elapsed = poll_elapsed();

		evt = oledd_input_poll();

		if (!g_ubus)
			g_ubus = oledd_ubus_open();
		oledd_menu_set_ubus(g_ubus);

		oledd_menu_tick(elapsed, evt);
		oledd_menu_render(elapsed);

		usleep(g_poll_ms * 1000);
	}

	oledd_input_close();
	oledd_ubus_close(g_ubus);
	g_ubus = NULL;
	clearDisplay();
	Display();
	return EXIT_SUCCESS;
}
