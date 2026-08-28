/*
 * mcudd_config — load /etc/config/mcud (no in-code defaults).
 */

#ifndef MCUDD_CONFIG_H
#define MCUDD_CONFIG_H

#include <stddef.h>

#define MCUDD_UCI_FILE "/etc/config/mcud"
#define MCUDD_WIRE_JSON "json"
#define MCUDD_WIRE_MSGPACK "msgpack"

enum mcudd_log_level {
	MCUDD_LOG_ERROR = 0,
	MCUDD_LOG_WARN,
	MCUDD_LOG_INFO,
	MCUDD_LOG_DEBUG,
};

struct mcudd_config {
	int enable;
	char path[128];
	int baud;
	char wire_format[16];
	int demo_mode;
	char pages[128];
	char wan_if[32];
	char lan_if[32];
	char wifi_if[32];
	unsigned interval_system_ms;
	unsigned interval_network_ms;
	int push_alerts;
	unsigned max_line;
	unsigned screen_timeout;
	char screen_timeout_mode[16];
	enum mcudd_log_level log_level;
	int debug;
	int debug_serial;
};

/* Returns 0 when all required options are present and valid. */
int mcudd_config_load(struct mcudd_config *cfg);

/* Test hook: load from an alternate UCI file path. */
int mcudd_config_load_file(const char *uci_path, struct mcudd_config *cfg);

#endif /* MCUDD_CONFIG_H */
