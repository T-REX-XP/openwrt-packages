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

static volatile sig_atomic_t g_stop;

static void on_signal(int sig)
{
	(void)sig;
	g_stop = 1;
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
		syslog(LOG_INFO, "mcu screen: %s", msg.screen[0] ? msg.screen : "?");
		return 0;
	}

	if (strcmp(cfg->wire_format, MCUDD_WIRE_MSGPACK) == 0) {
		syslog(LOG_WARNING, "wire_format msgpack not supported yet");
		return -1;
	}

	if (mcudd_protocol_build_scope(cfg, msg.scope, payload, sizeof(payload)) != 0)
		return -1;

	if (mcudd_protocol_format_out(cfg, &msg, payload, out, sizeof(out)) != 0)
		return -1;

	return mcudd_serial_write_line(fd, out);
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
