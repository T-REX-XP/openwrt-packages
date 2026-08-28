/*
 * mcudd — UART bridge daemon for ESP32 smart display (Phase 1).
 */

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "mcudd_config.h"
#include "mcudd_log.h"
#include "mcudd_protocol.h"
#include "mcudd_serial.h"

#define MCUDD_STATE_FILE "/tmp/mcud_state"
#define MCUDD_ACTIVE_FILE "/tmp/mcud_active_screen"
#define MCUDD_FIFO_PATH "/var/run/mcudd.fifo"
#define MCUDD_FIFO_FALLBACK "/tmp/mcudd.fifo"
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

static void write_active_screen(const char *screen_id)
{
	FILE *f;

	if (!screen_id || !screen_id[0])
		return;
	f = fopen(MCUDD_ACTIVE_FILE, "w");
	if (!f)
		return;
	fprintf(f, "%s\n", screen_id);
	fclose(f);
}

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
		char *nl;

		if (!eq)
			continue;
		*eq = '\0';
		nl = strchr(eq + 1, '\n');
		if (nl)
			*nl = '\0';
		if (stage && stage_len && !strcmp(line, "stage")) {
			strncpy(stage, eq + 1, stage_len - 1);
			stage[stage_len - 1] = '\0';
		}
		if (message && msg_len && !strcmp(line, "message")) {
			strncpy(message, eq + 1, msg_len - 1);
			message[msg_len - 1] = '\0';
		}
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

static int send_line(const struct mcudd_config *cfg, int fd, const char *line)
{
	if (!line)
		return -1;
	mcudd_log_serial(cfg, "tx", line);
	return mcudd_serial_write_line(fd, line);
}

static int send_boot_push(const struct mcudd_config *cfg, int fd)
{
	char stage[32];
	char message[96];
	char out[512];
	int pct;

	pct = read_boot_state(stage, sizeof(stage), message, sizeof(message));
	if (mcudd_protocol_build_push_boot(stage, message, (unsigned)pct, out, sizeof(out)) != 0)
		return -1;
	mcudd_log_proto(cfg, "push boot stage=%s pct=%d", stage, pct);
	return send_line(cfg, fd, out);
}

static int send_config_push(const struct mcudd_config *cfg, int fd)
{
	char out[256];

	if (mcudd_protocol_build_push_config(cfg, out, sizeof(out)) != 0)
		return -1;
	mcudd_log_proto(cfg, "push config timeout=%us mode=%s",
			cfg->screen_timeout, cfg->screen_timeout_mode);
	return send_line(cfg, fd, out);
}

static int send_cmd_screen(const struct mcudd_config *cfg, int fd, const char *screen_id)
{
	char out[256];

	if (!screen_id || !screen_id[0])
		return -1;
	if (mcudd_protocol_build_cmd_screen(screen_id, out, sizeof(out)) != 0)
		return -1;
	strncpy(active_screen, screen_id, sizeof(active_screen) - 1);
	active_screen[sizeof(active_screen) - 1] = '\0';
	write_active_screen(active_screen);
	mcudd_log_proto(cfg, "cmd screen %s", screen_id);
	return send_line(cfg, fd, out);
}

static int boot_stage_is_ready(const char *stage)
{
	return stage && !strcmp(stage, "ready");
}

static int leave_boot_screen(const struct mcudd_config *cfg, int fd)
{
	char stage[32];

	read_boot_state(stage, sizeof(stage), NULL, 0);
	if (!boot_stage_is_ready(stage))
		return 0;
	if (strcmp(active_screen, "router_boot") != 0)
		return 0;

	if (send_boot_push(cfg, fd) != 0)
		mcudd_log(LOG_WARNING, "leave_boot: boot push failed");
	mcudd_log(LOG_INFO, "leave_boot: router_boot -> router_system");
	return send_cmd_screen(cfg, fd, "router_system");
}

static int handle_nav(const struct mcudd_config *cfg, int fd, const char *cmd)
{
	const char *next = NULL;

	if (!cmd)
		return -1;
	if (!strcmp(cmd, "next"))
		next = page_neighbor(active_screen, "left");
	else if (!strcmp(cmd, "prev"))
		next = page_neighbor(active_screen, "right");
	if (!next)
		return -1;
	mcudd_log(LOG_INFO, "nav %s from %s -> %s", cmd, active_screen, next);
	return send_cmd_screen(cfg, fd, next);
}

static int handle_fifo_line(const struct mcudd_config *cfg, int fd, const char *line)
{
	char screen[48];

	if (!line || !line[0])
		return 0;
	if (!strcmp(line, "prev") || !strcmp(line, "next"))
		return handle_nav(cfg, fd, line);
	if (!strcmp(line, "boot"))
		return send_boot_push(cfg, fd);
	if (!strcmp(line, "ready"))
		return leave_boot_screen(cfg, fd);
	if (!strncmp(line, "screen ", 7)) {
		strncpy(screen, line + 7, sizeof(screen) - 1);
		screen[sizeof(screen) - 1] = '\0';
		return send_cmd_screen(cfg, fd, screen);
	}
	if (!strcmp(line, "net") || !strcmp(line, "refresh")) {
		if (!strcmp(active_screen, "router_boot"))
			return leave_boot_screen(cfg, fd);
		return send_cmd_screen(cfg, fd, active_screen);
	}
	mcudd_log(LOG_DEBUG, "ignored fifo: %s", line);
	return 0;
}

static int fifo_open(void)
{
	const char *path = MCUDD_FIFO_PATH;
	int fifo_fd;

	unlink(MCUDD_FIFO_FALLBACK);
	if (mkfifo(path, 0600) != 0 && errno != EEXIST) {
		path = MCUDD_FIFO_FALLBACK;
		if (mkfifo(path, 0600) != 0 && errno != EEXIST)
			return -1;
	}
	fifo_fd = open(path, O_RDONLY | O_NONBLOCK);
	if (fifo_fd < 0)
		return -1;
	mcudd_log(LOG_INFO, "command FIFO %s", path);
	return fifo_fd;
}

static int handle_gesture(const struct mcudd_config *cfg, int fd, const char *dir)
{
	const char *next = page_neighbor(active_screen, dir);

	mcudd_log(LOG_INFO, "gesture %s from %s -> %s", dir, active_screen, next);
	return send_cmd_screen(cfg, fd, next);
}

static int handle_line(const struct mcudd_config *cfg, int fd, const char *line)
{
	struct mcudd_parsed_msg msg;
	char payload[2048];
	char out[4096];

	mcudd_log_serial(cfg, "rx", line);

	if (mcudd_protocol_parse(line, &msg) != 0) {
		mcudd_log(LOG_DEBUG, "ignored line: %s", line);
		return 0;
	}

	mcudd_log_proto(cfg, "frame type=%d scope=%d screen=%s",
			(int)msg.type, (int)msg.scope, msg.screen);

	if (msg.type == MCUDD_MSG_RDCP_EVT) {
		strncpy(active_screen, msg.screen, sizeof(active_screen) - 1);
		active_screen[sizeof(active_screen) - 1] = '\0';
		write_active_screen(active_screen);
		mcudd_log(LOG_INFO, "screen: %s", msg.screen);
		if (!strcmp(msg.screen, "router_boot"))
			return send_boot_push(cfg, fd);
		return 0;
	}

	if (msg.type == MCUDD_MSG_RDCP_EVT_INPUT) {
		if (strcmp(cfg->wire_format, MCUDD_WIRE_MSGPACK) == 0) {
			mcudd_log(LOG_WARNING, "wire_format msgpack not supported yet");
			return -1;
		}
		return handle_gesture(cfg, fd, msg.gesture_dir);
	}

	if (strcmp(cfg->wire_format, MCUDD_WIRE_MSGPACK) == 0) {
		mcudd_log(LOG_WARNING, "wire_format msgpack not supported yet");
		return -1;
	}

	if (mcudd_protocol_build_scope(cfg, msg.scope, payload, sizeof(payload)) != 0)
		return -1;

	if (mcudd_protocol_format_out(cfg, &msg, payload, out, sizeof(out)) != 0)
		return -1;

	mcudd_log_proto(cfg, "scope %d req_id=%u (%u bytes)", (int)msg.scope,
			msg.req_id, (unsigned)strlen(out));
	return send_line(cfg, fd, out);
}

static void log_startup_config(const struct mcudd_config *cfg)
{
	static const char *const level_names[] = { "error", "warn", "info", "debug" };
	const char *level = "info";

	if (cfg->log_level >= MCUDD_LOG_ERROR &&
	    cfg->log_level <= MCUDD_LOG_DEBUG)
		level = level_names[cfg->log_level];

	mcudd_log(LOG_INFO,
		  "config: path=%s baud=%d wire=%s pages=%s wan=%s lan=%s wifi=%s",
		  cfg->path, cfg->baud, cfg->wire_format, cfg->pages, cfg->wan_if,
		  cfg->lan_if, cfg->wifi_if);
	mcudd_log(LOG_INFO,
		  "intervals: system=%ums network=%ums push_alerts=%d max_line=%u",
		  cfg->interval_system_ms, cfg->interval_network_ms,
		  cfg->push_alerts, cfg->max_line);
	mcudd_log(LOG_INFO,
		  "logging: level=%s debug=%d debug_serial=%d",
		  level, cfg->debug, cfg->debug_serial);
}

int main(int argc, char **argv)
{
	struct mcudd_config cfg;
	char *line_buf = NULL;
	size_t line_len = 0;
	int fd = -1;
	int fifo_fd = -1;
	char fifo_buf[128];
	size_t fifo_len = 0;
	int ret = 1;

	(void)argc;
	(void)argv;

	signal(SIGTERM, on_signal);
	signal(SIGINT, on_signal);

	if (mcudd_config_load(&cfg) != 0) {
		mcudd_log_init(NULL);
		mcudd_log(LOG_ERR, "invalid or incomplete %s", MCUDD_UCI_FILE);
		goto out;
	}

	mcudd_log_init(&cfg);

	if (!cfg.enable) {
		mcudd_log(LOG_INFO, "disabled in UCI");
		ret = 0;
		goto out;
	}

	log_startup_config(&cfg);

	line_buf = calloc(cfg.max_line + 2, 1);
	if (!line_buf) {
		mcudd_log(LOG_ERR, "out of memory");
		goto out;
	}

	mcudd_log(LOG_INFO, "opening UART %s @ %d", cfg.path, cfg.baud);
	fd = mcudd_serial_open(cfg.path, cfg.baud);
	if (fd < 0) {
		mcudd_log(LOG_ERR, "cannot open %s: %s", cfg.path, strerror(errno));
		goto out;
	}
	mcudd_log(LOG_INFO, "UART open on %s", cfg.path);

	fifo_fd = fifo_open();
	write_active_screen(active_screen);

	if (send_boot_push(&cfg, fd) != 0)
		mcudd_log(LOG_WARNING, "initial boot push failed");

	if (send_config_push(&cfg, fd) != 0)
		mcudd_log(LOG_WARNING, "screen timeout config push failed");
	else
		mcudd_log(LOG_INFO, "screen timeout: %us mode=%s",
			  cfg.screen_timeout, cfg.screen_timeout_mode);

	leave_boot_screen(&cfg, fd);

	while (!g_stop) {
		struct pollfd pfds[2];
		int nfds = 1;
		char ch;
		int pr, rr;
		static unsigned idle_polls;

		pfds[0].fd = fd;
		pfds[0].events = POLLIN;
		if (fifo_fd >= 0) {
			pfds[1].fd = fifo_fd;
			pfds[1].events = POLLIN;
			nfds = 2;
		}

		pr = poll(pfds, nfds, 500);
		if (pr < 0) {
			if (errno == EINTR)
				continue;
			mcudd_log(LOG_ERR, "poll failed: %s", strerror(errno));
			break;
		}
		if (pr == 0) {
			if (++idle_polls >= 4) {
				idle_polls = 0;
				leave_boot_screen(&cfg, fd);
			}
			continue;
		}
		idle_polls = 0;

		if (fifo_fd >= 0 && (pfds[1].revents & POLLIN)) {
			char fch;

			while (read(fifo_fd, &fch, 1) == 1) {
				if (fch == '\n' || fch == '\r') {
					if (fifo_len > 0) {
						fifo_buf[fifo_len] = '\0';
						handle_fifo_line(&cfg, fd, fifo_buf);
						fifo_len = 0;
					}
					continue;
				}
				if (fifo_len < sizeof(fifo_buf) - 1)
					fifo_buf[fifo_len++] = fch;
			}
		}

		if (!(pfds[0].revents & POLLIN))
			continue;

		rr = mcudd_serial_read_char(fd, &ch);
		if (rr < 0) {
			mcudd_log(LOG_ERR, "UART read error: %s", strerror(errno));
			break;
		}
		if (rr == 0)
			continue;

		if (cfg.debug_serial && ch != '\n' && ch != '\r') {
			char one[2] = { ch, '\0' };
			mcudd_log_serial(&cfg, "rx-char", one);
		}

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
			mcudd_log(LOG_WARNING, "line exceeded max_line=%u", cfg.max_line);
	}

	if (g_stop)
		mcudd_log(LOG_INFO, "shutdown requested");
	ret = 0;

out:
	if (fifo_fd >= 0)
		close(fifo_fd);
	unlink(MCUDD_FIFO_PATH);
	unlink(MCUDD_FIFO_FALLBACK);
	if (fd >= 0) {
		mcudd_log(LOG_INFO, "closing UART");
		mcudd_serial_close(fd);
	}
	free(line_buf);
	closelog();
	return ret;
}
