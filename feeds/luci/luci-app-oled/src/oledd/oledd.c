/*
 * oledd — Phase 1 OLED menu daemon (SH1106 128×64).
 * Boot splash, auto-rotating Boot / System / Ports views.
 * Metrics via popen("ubus call system info") and /sys/class/net.
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

#define STATE_FILE "/tmp/oled_state"
#define NET_TICK_FILE "/tmp/oled_net_changed"
#define POLL_MS_DEFAULT 800
#define VIEW_TIMEOUT_DEFAULT 5
#define BOOT_DONE_STAGE "ready"

enum oled_view {
	VIEW_BOOT = 0,
	VIEW_SYSTEM,
	VIEW_PORTS,
	VIEW_COUNT
};

static const char *port_ifaces[] = { "eth0", "eth1", "br-lan" };
#define PORT_COUNT 3

static volatile sig_atomic_t g_stop;
static char g_i2c_path[32] = I2C_DEV0_PATH;
static int g_rotate;
static unsigned g_poll_ms = POLL_MS_DEFAULT;
static unsigned g_view_timeout = VIEW_TIMEOUT_DEFAULT;

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

static int iface_up(const char *ifname)
{
	char path[96];
	char state[16];
	FILE *f;

	snprintf(path, sizeof(path), "/sys/class/net/%s/operstate", ifname);
	f = fopen(path, "r");
	if (!f)
		return 0;
	if (fscanf(f, "%15s", state) != 1) {
		fclose(f);
		return 0;
	}
	fclose(f);
	return strcmp(state, "up") == 0;
}

static unsigned long json_ulong(const char *json, const char *key,
				unsigned long def)
{
	char pat[48];
	const char *p;
	char *end;

	snprintf(pat, sizeof(pat), "\"%s\":", key);
	p = strstr(json, pat);
	if (!p)
		return def;
	p += strlen(pat);
	while (*p == ' ' || *p == '\t')
		p++;
	return strtoul(p, &end, 10);
}

static int ubus_system_info(unsigned long *uptime, float *load1,
			    unsigned long *mem_total, unsigned long *mem_free)
{
	char buf[2048];
	const char *loadp;
	unsigned long l0 = 0;
	FILE *fp = popen("ubus call system info 2>/dev/null", "r");

	if (!fp)
		return -1;
	if (!fread(buf, 1, sizeof(buf) - 1, fp)) {
		pclose(fp);
		return -1;
	}
	buf[sizeof(buf) - 1] = '\0';
	pclose(fp);

	*uptime = json_ulong(buf, "uptime", 0);
	loadp = strstr(buf, "\"load\":");
	if (loadp) {
		loadp = strchr(loadp, '[');
		if (loadp)
			l0 = strtoul(loadp + 1, NULL, 10);
	}
	*load1 = (float)l0 / 65536.0f;

	{
		const char *mp = strstr(buf, "\"memory\"");

		if (mp) {
			*mem_total = json_ulong(mp, "total", 0);
			*mem_free = json_ulong(mp, "free", 0);
		} else {
			*mem_total = 0;
			*mem_free = 0;
		}
	}
	return 0;
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
	unsigned long uptime = 0, mem_total = 0, mem_free = 0;
	float load1 = 0.0f;
	char upbuf[24];
	unsigned long mem_used_mb;

	draw_header("System");

	if (ubus_system_info(&uptime, &load1, &mem_total, &mem_free) != 0) {
		setCursor(0, 16);
		print_str((const unsigned char *)"ubus unavailable");
		return;
	}

	format_uptime(uptime, upbuf, sizeof(upbuf));
	mem_used_mb = mem_total > mem_free ? (mem_total - mem_free) / 1024 : 0;

	setCursor(0, 14);
	print_str((const unsigned char *)"Up: ");
	print_str((const unsigned char *)upbuf);

	setCursor(0, 26);
	print_str((const unsigned char *)"Load: ");
	printFloat((double)load1, 2);

	setCursor(0, 38);
	print_str((const unsigned char *)"RAM: ");
	printNumber_UI((unsigned int)mem_used_mb, DEC);
	print_str((const unsigned char *)"K used");
}

static void draw_ports_view(void)
{
	int i, y = 14;

	draw_header("Ports");

	for (i = 0; i < PORT_COUNT; i++) {
		const char *name = port_ifaces[i];
		int up = iface_up(name);

		setCursor(0, y);
		print_str((const unsigned char *)name);
		setCursor(90, y);
		print_str((const unsigned char *)(up ? "UP" : "down"));
		y += 12;
	}
}

static void render_view(enum oled_view view)
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
		draw_ports_view();
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

	if (init_i2c_dev(g_i2c_path, SSD1306_OLED_ADDR) != 0) {
		fprintf(stderr, "oledd: I2C init failed on %s\n", g_i2c_path);
		return EXIT_FAILURE;
	}

	display_Init_seq();
	if (g_rotate)
		display_rotate();
	else
		display_normal();

	show_splash();

	view_started = time(NULL);
	render_view(VIEW_BOOT);

	while (!g_stop) {
		int force_redraw = 0;
		struct stat st;

		if (stat(NET_TICK_FILE, &st) == 0) {
			unlink(NET_TICK_FILE);
			force_redraw = 1;
			if (!in_boot)
				view = VIEW_PORTS;
		}

		now = time(NULL);
		if (in_boot) {
			if (!boot_active()) {
				in_boot = 0;
				view = VIEW_SYSTEM;
				view_started = now;
			}
		} else if ((unsigned)(now - view_started) >= g_view_timeout) {
			do {
				view = (enum oled_view)((view + 1) % VIEW_COUNT);
			} while (view == VIEW_BOOT);
			view_started = now;
			force_redraw = 1;
		}

		if (force_redraw || in_boot)
			render_view(in_boot ? VIEW_BOOT : view);

		usleep(g_poll_ms * 1000);
	}

	clearDisplay();
	Display();
	return EXIT_SUCCESS;
}
