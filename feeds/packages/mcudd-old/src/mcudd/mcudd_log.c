/*
 * mcudd_log — syslog with UCI-driven verbosity.
 */

#include "mcudd_log.h"

#include <stdarg.h>
#include <stdio.h>

static int log_mask_for_level(enum mcudd_log_level level)
{
	switch (level) {
	case MCUDD_LOG_ERROR:
		return LOG_UPTO(LOG_ERR);
	case MCUDD_LOG_WARN:
		return LOG_UPTO(LOG_WARNING);
	case MCUDD_LOG_INFO:
		return LOG_UPTO(LOG_INFO);
	case MCUDD_LOG_DEBUG:
		return LOG_UPTO(LOG_DEBUG);
	default:
		return LOG_UPTO(LOG_INFO);
	}
}

void mcudd_log_init(const struct mcudd_config *cfg)
{
	openlog("mcudd", LOG_PID | LOG_CONS, LOG_DAEMON);
	if (cfg)
		setlogmask(log_mask_for_level(cfg->log_level));
	else
		setlogmask(LOG_UPTO(LOG_INFO));
}

void mcudd_log(int pri, const char *fmt, ...)
{
	va_list ap;

	va_start(ap, fmt);
	vsyslog(pri, fmt, ap);
	va_end(ap);
}

void mcudd_log_proto(const struct mcudd_config *cfg, const char *fmt, ...)
{
	va_list ap;

	if (!cfg || !cfg->debug)
		return;

	va_start(ap, fmt);
	vsyslog(LOG_DEBUG, fmt, ap);
	va_end(ap);
}

void mcudd_log_serial(const struct mcudd_config *cfg, const char *dir, const char *data)
{
	if (!cfg || !cfg->debug_serial || !dir || !data)
		return;
	syslog(LOG_DEBUG, "uart %s: %s", dir, data);
}
