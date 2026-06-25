/*
 * oledd_input — FIFO event reader (Phase 3).
 */

#include "oledd_input.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#define FIFO_PRIMARY "/var/run/oledd.fifo"
#define FIFO_FALLBACK "/tmp/oledd.fifo"
#define EVENT_LOG "/tmp/oledd_events.log"

static int g_fd = -1;

static void log_event(const char *line)
{
	FILE *f = fopen(EVENT_LOG, "a");

	if (!f)
		return;
	fprintf(f, "%s\n", line);
	fclose(f);
}

static oledd_event_t parse_line(const char *line)
{
	if (!strcmp(line, "net"))
		return OLEDD_EV_NET;
	if (!strcmp(line, "up"))
		return OLEDD_EV_UP;
	if (!strcmp(line, "down"))
		return OLEDD_EV_DOWN;
	if (!strcmp(line, "ok"))
		return OLEDD_EV_OK;
	if (!strcmp(line, "back"))
		return OLEDD_EV_BACK;
	if (!strcmp(line, "next"))
		return OLEDD_EV_NEXT;
	if (!strcmp(line, "refresh"))
		return OLEDD_EV_REFRESH;
	return OLEDD_EV_NONE;
}

static int open_fifo(const char *path)
{
	int fd;

	if (mkfifo(path, 0600) != 0 && errno != EEXIST)
		return -1;

	fd = open(path, O_RDONLY | O_NONBLOCK);
	return fd;
}

int oledd_input_init(void)
{
	g_fd = open_fifo(FIFO_PRIMARY);
	if (g_fd >= 0)
		return 0;

	g_fd = open_fifo(FIFO_FALLBACK);
	return g_fd >= 0 ? 0 : -1;
}

void oledd_input_close(void)
{
	if (g_fd >= 0) {
		close(g_fd);
		g_fd = -1;
	}
}

oledd_event_t oledd_input_poll(void)
{
	char buf[32];
	ssize_t n;
	oledd_event_t ev;

	if (g_fd < 0)
		return OLEDD_EV_NONE;

	n = read(g_fd, buf, sizeof(buf) - 1);
	if (n <= 0)
		return OLEDD_EV_NONE;

	buf[n] = '\0';
	buf[strcspn(buf, "\r\n")] = '\0';
	if (!buf[0])
		return OLEDD_EV_NONE;

	log_event(buf);
	ev = parse_line(buf);
	return ev;
}
