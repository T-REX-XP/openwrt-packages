/*
 * mcudd — UART bridge daemon for ESP32 smart display (Phase 1).
 */

#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <syslog.h>
#include <unistd.h>

#include "mcudd_config.h"
#include "mcudd_protocol.h"
#include "mcudd_serial.h"

#define MCUDD_STATE_FILE "/tmp/mcud_state"
#define MCUDD_PAGE_COUNT 6

static volatile sig_atomic_t g_stop;

static const char *const PAGE_IDS[MCUDD_PAGE_COUNT] = {
	"router_system",
	"router_network",
	"router_clients",
	"router_storage",
	"router_wifi",
	"router_security",
};

static char active_screen[48] = "router_boot";

static void on_signal(int sig)
{
	(void)sig;
	g_stop = 1;
}

static int read_boot_state(char *stage, size_t stage_len, char *message, size_t msg_len)
{
	FILE *f;
	char line[128];
	int pct = 10;

	if (stage && stage_len)
		stage[0] = '\0';
	if (message && msg_len)
		message[0] = '\0';

	f = fopen(MCUDD_STATE_FILE, "r");
	if (!f)
		return pct;

	while (fgets(line, sizeof(line), f)) {
		char *eq = strchr(line, '=');
		if (!eq)
			continue;
		*eq = '\0';
		if (stage && stage_len && !strcmp(line, "stage"))
			strncpy(stage, eq + 1, stage_len - 1);
		if (message && msg_len && !strcmp(line, "message"))
			strncpy(message, eq + 1, msg_len - 1);
		if (!strcmp(line, "pct"))
			pct = atoi(eq + 1);
	}
	fclose(f);

	if (stage && stage_len && !stage[0])
		strncpy(stage, "boot", stage_len - 1);
	if (message && msg_len && !message[0])
		strncpy(message, "Booting...", msg_len - 1);
	return pct > 100 ? 100 : (pct < 0 ? 0 : pct);
}

static int page_index(const char *screen_id)
{
	int i;

	if (!screen_id)
		return 0;
	for (i = 0; i < MCUDD_PAGE_COUNT; i++) {
		if (!strcmp(PAGE_IDS[i], screen_id))
			return i;
	}
	return 0;
}

static const char *page_neighbor(const char *screen_id, const char *dir)
{
	int idx;

	if (!screen_id || !strcmp(screen_id, "router_boot"))
		return PAGE_IDS[0];

	idx = page_index(screen_id);
	if (!dir || !strcmp(dir, "left"))
		return PAGE_IDS[(idx + 1) % MCUDD_PAGE_COUNT];
	return PAGE_IDS[(idx + MCUDD_PAGE_COUNT - 1) % MCUDD_PAGE_COUNT];
}

static int send_line(int fd, const char *line)
{
	if (!line)
		return -1;
	return mcudd_serial_write_line(fd, line);
}

static int send_boot_push(int fd)
{
	char stage[32];
	char message[96];
	char out[512];
	int pct;

	pct = read_boot_state(stage, sizeof(stage), message, sizeof(message));
	if (mcudd_protocol_build_push_boot(stage, message, (unsigned)pct, out, sizeof(out)) != 0)
		return -1;
	return send_line(fd, out);
}

static int send_cmd_screen(int fd, const char *screen_id)
{
	char out[256];

	if (!screen_id || !screen_id[0])
		return -1;
	if (mcudd_protocol_build_cmd_screen(screen_id, out, sizeof(out)) != 0)
		return -1;
	strncpy(active_screen, screen_id, sizeof(active_screen) - 1);
	return send_line(fd, out);
}

static int send_scope_response(const struct mcudd_config *cfg, int fd,
			       mcudd_scope_t scope, unsigned req_id)
{
	struct mcudd_parsed_msg fake = { .type = MCUDD_MSG_RDCP_REQ, .scope = scope,
					 .req_id = req_id };
	char payload[2048];
	char out[4096];

	if (mcudd_protocol_build_scope(cfg, scope, payload, sizeof(payload)) != 0)
		return -1;
	if (mcudd_protocol_format_out(cfg, &fake, payload, out, sizeof(out)) != 0)
		return -1;
	return send_line(fd, out);
}

static int handle_gesture(const struct mcudd_config *cfg, int fd, const char *dir)
{
	const char *next = page_neighbor(active_screen, dir);

	syslog(LOG_INFO, "mcu gesture %s from %s -> %s", dir, active_screen, next);
	return send_cmd_screen(fd, next);
}

static int handle_line(const struct mcudd_config *cfg, int fd, const char *line)
{
	struct mcudd_parsed_msg msg;
	char payload[2048];
	char out[4096];

	if (mcudd_protocol_parse(line, &msg) != 0) {
		syslog(LOG_DEBUG, "ignored line: %s", line);
		return 0;
	}

	if (msg.type == MCUDD_MSG_RDCP_EVT) {
		strncpy(active_screen, msg.screen, sizeof(active_screen) - 1);
		syslog(LOG_INFO, "mcu screen: %s", msg.screen);
		if (!strcmp(msg.screen, "router_boot"))
			return send_boot_push(fd);
		return 0;
	}

	if (msg.type == MCUDD_MSG_RDCP_EVT_INPUT) {
		if (strcmp(cfg->wire_format, MCUDD_WIRE_MSGPACK) == 0) {
			syslog(LOG_WARNING, "wire_format msgpack not supported yet");
			return -1;
		}
		return handle_gesture(cfg, fd, msg.gesture_dir);
	}

	if (strcmp(cfg->wire_format, MCUDD_WIRE_MSGPACK) == 0) {
		syslog(LOG_WARNING, "wire_format msgpack not supported yet");
		return -1;
	}

	if (mcudd_protocol_build_scope(cfg, msg.scope, payload, sizeof(payload)) != 0)
		return -1;

	if (mcudd_protocol_format_out(cfg, &msg, payload, out, sizeof(out)) != 0)
		return -1;

	return send_line(fd, out);
}

int main(int argc, char **argv)
{
	struct mcudd_config cfg;
	char *line_buf = NULL;
	size_t line_len = 0;
	int fd = -1;
	int ret = 1;

	(void)argc;
	(void)argv;

	openlog("mcudd", LOG_PID | LOG_CONS, LOG_DAEMON);
	signal(SIGTERM, on_signal);
	signal(SIGINT, on_signal);

	if (mcudd_config_load(&cfg) != 0) {
		syslog(LOG_ERR, "invalid or incomplete %s", MCUDD_UCI_FILE);
		goto out;
	}

	if (!cfg.enable) {
		syslog(LOG_INFO, "disabled in UCI");
		ret = 0;
		goto out;
	}

	line_buf = calloc(cfg.max_line + 2, 1);
	if (!line_buf) {
		syslog(LOG_ERR, "out of memory");
		goto out;
	}

	fd = mcudd_serial_open(cfg.path, cfg.baud);
	if (fd < 0) {
		syslog(LOG_ERR, "cannot open %s: %s", cfg.path, strerror(errno));
		goto out;
	}

	syslog(LOG_INFO, "started on %s @ %d (%s)", cfg.path, cfg.baud,
	       cfg.wire_format);

	if (send_boot_push(fd) != 0)
		syslog(LOG_WARNING, "initial boot push failed");

	while (!g_stop) {
		struct pollfd pfd = { .fd = fd, .events = POLLIN };
		char ch;
		int pr, rr;

		pr = poll(&pfd, 1, 500);
		if (pr < 0) {
			if (errno == EINTR)
				continue;
			break;
		}
		if (pr == 0)
			continue;

		rr = mcudd_serial_read_char(fd, &ch);
		if (rr < 0)
			break;
		if (rr == 0)
			continue;

		if (ch == '\n' || ch == '\r') {
			if (line_len > 0) {
				line_buf[line_len] = '\0';
				handle_line(&cfg, fd, line_buf);
				line_len = 0;
			}
			continue;
		}

		if (line_len < cfg.max_line)
			line_buf[line_len++] = ch;
		else
			syslog(LOG_WARNING, "line exceeded max_line=%u", cfg.max_line);
	}

	ret = 0;

out:
	if (fd >= 0)
		mcudd_serial_close(fd);
	free(line_buf);
	closelog();
	return ret;
}
