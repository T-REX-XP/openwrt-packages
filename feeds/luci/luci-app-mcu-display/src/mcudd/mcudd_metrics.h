/*
 * mcudd_metrics — router metrics from /proc and /sys (scope payloads).
 */

#ifndef MCUDD_METRICS_H
#define MCUDD_METRICS_H

#include <stddef.h>

#include "mcudd_config.h"

int mcudd_metrics_system(const struct mcudd_config *cfg, char *buf, size_t len);
int mcudd_metrics_network(const struct mcudd_config *cfg, char *buf, size_t len);
int mcudd_metrics_clients(const struct mcudd_config *cfg, char *buf, size_t len);
int mcudd_metrics_storage(const struct mcudd_config *cfg, char *buf, size_t len);
int mcudd_metrics_wifi(const struct mcudd_config *cfg, char *buf, size_t len);
int mcudd_metrics_security(const struct mcudd_config *cfg, char *buf, size_t len);
int mcudd_metrics_alarms(const struct mcudd_config *cfg, char *buf, size_t len);

#endif /* MCUDD_METRICS_H */
