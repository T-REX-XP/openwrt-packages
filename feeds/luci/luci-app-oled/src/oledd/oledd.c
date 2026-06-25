/*
 * oledd — OLED menu daemon (SH1106 128×64).
 * Phase 4: ubus control API, error overlays, idle dim.
 */

#include <getopt.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <syslog.h>
#include <time.h>
#include <unistd.h>

#include "I2C.h"
#include "SSD1306_OLED.h"
#include "oledd_alert.h"
#include "oledd_config.h"
#include "oledd_input.h"
#include "oledd_menu.h"
#include "oledd_net.h"
#include "oledd_ubus.h"
#include "oledd_ubus_srv.h"

#define POLL_MS_DEFAULT 800
#define VIEW_TIMEOUT_DEFAULT 5
#define I2C_INIT_RETRIES 15
#define I2C_INIT_DELAY_US 500000

static const struct oledd_port_entry cm5_ports[] = {
	{ "eth0", "wan", "WAN" },
	{ "eth1", NULL, "L1" },
	{ "eth2", NULL, "L2" },
};

static volatile sig_atomic_t g_stop;
static char g_i2c_path[32] = I2C_DEV0_PATH;
static int g_rotate;
static int g_menu_wifi = 1;
static int g_menu_interactive = 0;
static int g_menu_alerts = 1;
static unsigned g_poll_ms = POLL_MS_DEFAULT;
static unsigned g_view_timeout = VIEW_TIMEOUT_DEFAULT;
static struct timespec g_last_poll;
static struct ubus_context *g_ubus;
static int g_ubus_registered;

static void oledd_log(int pri, const char *fmt, ...)
{
	va_list ap;

	va_start(ap, fmt);
	vsyslog(pri, fmt, ap);
	va_end(ap);
}

static void oledd_ubus_try_register(void)
{
	if (!g_ubus || g_ubus_registered)
		return;

	if (oledd_ubus_srv_register(g_ubus, g_i2c_path, g_menu_interactive) == 0)
		g_ubus_registered = 1;
	else
		oledd_log(LOG_WARNING, "ubus object registration failed");
}

static void on_signal(int sig)
{
	(void)sig;
	g_stop = 1;
}

static int init_display(void)
{
	int i, ret;

	for (i = 0; i < I2C_INIT_RETRIES; i++) {
		if (init_i2c_dev(g_i2c_path, SSD1306_OLED_ADDR) == 0)
			break;
		oledd_log(LOG_WARNING, "I2C init failed on %s (retry %d/%d)",
			  g_i2c_path, i + 1, I2C_INIT_RETRIES);
		usleep(I2C_INIT_DELAY_US);
	}
	if (i >= I2C_INIT_RETRIES) {
		oledd_log(LOG_ERR, "I2C init failed on %s — giving up", g_i2c_path);
		return -1;
	}

	if (display_Init_seq() != 0) {
		oledd_log(LOG_ERR, "SH1106 init sequence failed on %s", g_i2c_path);
		return -1;
	}

	if (g_rotate)
		display_rotate();
	else
		display_normal();

	ret = 0;
	clearDisplay();
	setTextSize(2);
	setTextColor(WHITE);
	setCursor(4, 20);
	print_str((const unsigned char *)"BOOTING...");
	if (Display() != 0) {
		oledd_log(LOG_WARNING, "initial BOOTING splash flush failed");
		ret = -1;
	}
	return ret;
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

	openlog("oledd", LOG_PID | LOG_CONS, LOG_DAEMON);
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
	g_menu_alerts = oledd_config_menu_alerts();
	oledd_config_menu_nav_button(nav_btn, sizeof(nav_btn));
	oledd_config_menu_select_button(sel_btn, sizeof(sel_btn));
	oledd_log(LOG_INFO, "starting nav=%s select=%s interactive=%d i2c=%s",
		  nav_btn, sel_btn, g_menu_interactive, g_i2c_path);

	oledd_net_ports_init(cm5_ports,
			     (int)(sizeof(cm5_ports) / sizeof(cm5_ports[0])));

	if (init_display() != 0) {
		oledd_log(LOG_ERR, "oledd startup failed — exiting");
		closelog();
		return EXIT_FAILURE;
	}

	oledd_menu_init(g_menu_interactive, g_menu_wifi, g_view_timeout, NULL);
	memset(&g_last_poll, 0, sizeof(g_last_poll));
	oledd_menu_render(0.0);

	g_ubus = oledd_ubus_open();
	if (!g_ubus)
		oledd_log(LOG_WARNING, "ubus unavailable — views will retry in loop");
	else
		oledd_ubus_try_register();

	oledd_input_init();
	oledd_alert_init(g_menu_alerts);
	oledd_menu_set_ubus(g_ubus);

	while (!g_stop) {
		double elapsed = poll_elapsed();

		if (g_ubus)
			oledd_ubus_srv_poll(g_ubus);

		evt = oledd_input_poll();

		if (!g_ubus)
			g_ubus = oledd_ubus_open();
		oledd_ubus_try_register();
		oledd_menu_set_ubus(g_ubus);
		oledd_alert_poll(g_ubus);

		oledd_menu_check_idle(g_view_timeout);
		oledd_menu_tick(elapsed, evt);
		oledd_menu_render(elapsed);

		usleep(g_poll_ms * 1000);
	}

	oledd_ubus_srv_unregister(g_ubus);
	oledd_input_close();
	oledd_ubus_close(g_ubus);
	g_ubus = NULL;
	g_ubus_registered = 0;
	clearDisplay();
	Display();
	closelog();
	return EXIT_SUCCESS;
}
