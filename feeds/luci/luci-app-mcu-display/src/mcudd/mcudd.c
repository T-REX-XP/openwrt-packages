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
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#include "mcudd_config.h"
#include "mcudd_log.h"
#include "mcudd_pages.h"
#include "mcudd_protocol.h"
#include "mcudd_serial.h"
#include "mcud_version.h"

#define MCUDD_STATE_FILE "/tmp/mcud_state"
#define MCUDD_ACTIVE_FILE "/tmp/mcud_active_screen"
#define MCUDD_FW_VERSION_FILE "/tmp/mcud_firmware_version.json"
#define MCUDD_FIFO_PATH "/var/run/mcudd.fifo"
#define MCUDD_FIFO_FALLBACK "/tmp/mcudd.fifo"
#define MCUDD_LOCK_FILE "/var/run/mcudd.lock"

static volatile sig_atomic_t g_stop;
static int g_lock_fd = -1;

static char active_screen[48] = "router_boot";
static unsigned g_version_req_id;

static void write_firmware_version(const struct mcudd_parsed_msg *msg)
{
	FILE *f;

	if (!msg)
		return;
	f = fopen(MCUDD_FW_VERSION_FILE, "w");
	if (!f)
		return;
	fprintf(f,
		"{\"stack\":\"%s\",\"release\":%u,\"component\":\"%s\",\"rdcp\":%u,\"synced\":%s}\n",
		msg->version_stack, msg->version_release, msg->version_component,
		msg->version_rdcp,
		mcud_version_compatible(msg->version_stack, msg->version_release,
					 msg->version_rdcp) ? "true" : "false");
	fclose(f);
}

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

static int acquire_instance_lock(void)
{
	g_lock_fd = open(MCUDD_LOCK_FILE, O_CREAT | O_RDWR, 0644);
	if (g_lock_fd < 0)
		return -1;
	if (flock(g_lock_fd, LOCK_EX | LOCK_NB) != 0) {
		close(g_lock_fd);
		g_lock_fd = -1;
		return -1;
	}
	return 0;
}

static void release_instance_lock(void)
{
	if (g_lock_fd >= 0) {
		flock(g_lock_fd, LOCK_UN);
		close(g_lock_fd);
		g_lock_fd = -1;
	}
}

static void print_usage(const char *prog)
{
	printf("Usage: %s [--version|-V]\n", prog ? prog : "mcudd");
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

static int send_hello_push(const struct mcudd_config *cfg, int fd)
{
	char out[256];

	if (mcudd_protocol_build_push_hello(out, sizeof(out)) != 0)
		return -1;
	mcudd_log(LOG_INFO, "push hello %s", mcud_version_string());
	return send_line(cfg, fd, out);
}

static int send_version_query(const struct mcudd_config *cfg, int fd)
{
	char out[128];

	g_version_req_id++;
	if (mcudd_protocol_build_req_version(g_version_req_id, out, sizeof(out)) != 0)
		return -1;
	mcudd_log(LOG_INFO, "req version id=%u", g_version_req_id);
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

static int send_cmd_screen_dir(const struct mcudd_config *cfg, int fd,
			       const char *screen_id, const char *dir)
{
	char out[256];
	int rc;

	if (!screen_id || !screen_id[0])
		return -1;
	if (mcudd_protocol_build_cmd_screen_dir(screen_id, dir, out, sizeof(out)) != 0)
		return -1;
	rc = send_line(cfg, fd, out);
	if (rc != 0) {
		mcudd_log(LOG_WARNING, "cmd screen %s tx failed", screen_id);
		return rc;
	}
	if (mcudd_screen_id_known(screen_id)) {
		strncpy(active_screen, screen_id, sizeof(active_screen) - 1);
		active_screen[sizeof(active_screen) - 1] = '\0';
		write_active_screen(active_screen);
	}
	mcudd_log(LOG_INFO, "cmd screen %s (await screen evt)", screen_id);
	return 0;
}

static int send_cmd_screen(const struct mcudd_config *cfg, int fd, const char *screen_id)
{
	return send_cmd_screen_dir(cfg, fd, screen_id, "left");
}

static int mcudd_trigger_poweroff(void)
{
	pid_t pid;

	mcudd_log(LOG_WARNING, "display requested system poweroff");
	pid = fork();
	if (pid < 0) {
		mcudd_log(LOG_ERR, "poweroff fork failed: %s", strerror(errno));
		return -1;
	}
	if (pid == 0) {
		execl("/sbin/poweroff", "poweroff", (char *)NULL);
		execl("/usr/sbin/poweroff", "poweroff", (char *)NULL);
		_exit(1);
	}
	return 0;
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
	const char *anim_dir;
	const char *target;

	if (!cmd)
		return -1;
	if (!strcmp(cmd, "next"))
		anim_dir = "left";
	else if (!strcmp(cmd, "prev"))
		anim_dir = "right";
	else
		return -1;

	target = mcudd_page_neighbor(active_screen, anim_dir);
	mcudd_log(LOG_INFO, "nav %s: %s -> %s", cmd, active_screen, target);
	return send_cmd_screen_dir(cfg, fd, target, anim_dir);
}

static int handle_fifo_line(const struct mcudd_config *cfg, int fd, const char *line)
{
	char screen[48];

	if (!line || !line[0])
		return 0;
	mcudd_log(LOG_INFO, "fifo: %s", line);
	if (!strcmp(line, "prev") || !strcmp(line, "next"))
		return handle_nav(cfg, fd, line);
	if (!strcmp(line, "boot"))
		return send_boot_push(cfg, fd);
	if (!strcmp(line, "ready"))
		return leave_boot_screen(cfg, fd);
	if (!strncmp(line, "screen ", 7)) {
		strncpy(screen, line + 7, sizeof(screen) - 1);
		screen[sizeof(screen) - 1] = '\0';
		if (!mcudd_screen_id_known(screen)) {
			mcudd_log(LOG_WARNING, "ignore fifo screen: %s", screen);
			return -1;
		}
		return send_cmd_screen(cfg, fd, screen);
	}
	if (!strcmp(line, "net") || !strcmp(line, "refresh")) {
		if (!strcmp(active_screen, "router_boot"))
			return leave_boot_screen(cfg, fd);
		return send_cmd_screen(cfg, fd, active_screen);
	}
	if (!strcmp(line, "version"))
		return send_version_query(cfg, fd);
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
	const char *target;

	if (!dir || !dir[0])
		return -1;
	target = mcudd_page_neighbor(active_screen, dir);
	mcudd_log(LOG_INFO, "gesture %s: %s -> %s", dir, active_screen, target);
	return send_cmd_screen_dir(cfg, fd, target, dir);
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

	if (msg.type == MCUDD_MSG_RDCP_EVT_VERSION) {
		write_firmware_version(&msg);
		mcudd_log(LOG_INFO, "firmware version %s+%u rdcp=%u synced=%d",
			  msg.version_stack, msg.version_release, msg.version_rdcp,
			  mcud_version_compatible(msg.version_stack, msg.version_release,
						   msg.version_rdcp));
		return 0;
	}

	if (msg.type == MCUDD_MSG_RDCP_REQ_POWEROFF) {
		mcudd_log(LOG_WARNING, "RDCP poweroff req from display");
		return mcudd_trigger_poweroff();
	}

	if (msg.type == MCUDD_MSG_RDCP_EVT) {
		if (!mcudd_screen_id_known(msg.screen)) {
			mcudd_log(LOG_WARNING, "ignore unknown screen evt: %s", msg.screen);
			return 0;
		}
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
		  "mcud stack %s rdcp=%u pages_schema=%u",
		  mcud_version_string(), MCUD_RDCP_VERSION, MCUD_PAGES_SCHEMA);
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

	if (argc >= 2 && (!strcmp(argv[1], "-V") || !strcmp(argv[1], "--version"))) {
		printf("%s rdcp=%u pages_schema=%u component=%s\n",
		       mcud_version_string(), MCUD_RDCP_VERSION, MCUD_PAGES_SCHEMA,
		       MCUD_COMPONENT_HOST);
		return 0;
	}
	if (argc >= 2 &&
	    (!strcmp(argv[1], "-h") || !strcmp(argv[1], "--help") || !strcmp(argv[1], "help"))) {
		print_usage(argv[0]);
		return 0;
	}

	signal(SIGTERM, on_signal);
	signal(SIGINT, on_signal);

	mcudd_log_init(NULL);
	if (acquire_instance_lock() != 0) {
		mcudd_log(LOG_ERR, "another mcudd instance is already running");
		return 1;
	}

	if (mcudd_config_load(&cfg) != 0) {
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

	if (send_hello_push(&cfg, fd) != 0)
		mcudd_log(LOG_WARNING, "initial hello push failed");

	send_version_query(&cfg, fd);

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
	release_instance_lock();
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
