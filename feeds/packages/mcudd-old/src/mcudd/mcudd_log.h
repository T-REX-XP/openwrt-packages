/*
 * mcudd_log — syslog helpers gated by UCI log_level / debug flags.
 */

#ifndef MCUDD_LOG_H
#define MCUDD_LOG_H

#include "mcudd_config.h"

#include <syslog.h>

void mcudd_log_init(const struct mcudd_config *cfg);
void mcudd_log(int pri, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
void mcudd_log_proto(const struct mcudd_config *cfg, const char *fmt, ...)
	__attribute__((format(printf, 2, 3)));
void mcudd_log_serial(const struct mcudd_config *cfg, const char *dir, const char *data);

#endif /* MCUDD_LOG_H */
