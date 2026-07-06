/*
 * mcudd_config — parse UCI without fallback values in daemon code.
 */

#include "mcudd_config.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int parse_option_string(const char *file, const char *option,
			       char *out, size_t len)
{
	char line[256];
	char needle[64];
	FILE *f;

	if (!out || !len)
		return -1;
	out[0] = '\0';

	snprintf(needle, sizeof(needle), "option %s", option);
	f = fopen(file, "r");
	if (!f)
		return -1;

	while (fgets(line, sizeof(line), f)) {
		char *p, *val, endq;

		if (!strstr(line, needle))
			continue;

		p = strchr(line, '\'');
		if (!p) {
			p = strchr(line, '"');
			if (!p)
				continue;
		}
		endq = *p;
		val = p + 1;
		p = strchr(val, endq);
		if (!p)
			continue;
		*p = '\0';
		strncpy(out, val, len - 1);
		out[len - 1] = '\0';
		fclose(f);
		return 0;
	}

	fclose(f);
	return -1;
}

static int parse_option_int(const char *file, const char *option, int *out)
{
	char buf[32];

	if (!out)
		return -1;
	if (parse_option_string(file, option, buf, sizeof(buf)) != 0)
		return -1;
	*out = atoi(buf);
	return 0;
}

static int validate_wire_format(const char *fmt)
{
	return !strcmp(fmt, MCUDD_WIRE_JSON) || !strcmp(fmt, MCUDD_WIRE_MSGPACK);
}

int mcudd_config_load_file(const char *uci_path, struct mcudd_config *cfg)
{
	int v;

	if (!uci_path || !cfg)
		return -1;
	memset(cfg, 0, sizeof(*cfg));

	if (parse_option_int(uci_path, "enable", &v) != 0)
		return -1;
	cfg->enable = v;

	if (parse_option_string(uci_path, "path", cfg->path, sizeof(cfg->path)) != 0)
		return -1;
	if (!cfg->path[0])
		return -1;

	if (parse_option_int(uci_path, "baud", &v) != 0 || v <= 0)
		return -1;
	cfg->baud = v;

	if (parse_option_string(uci_path, "wire_format", cfg->wire_format,
				sizeof(cfg->wire_format)) != 0)
		return -1;
	if (!validate_wire_format(cfg->wire_format))
		return -1;

	if (parse_option_int(uci_path, "demo_mode", &v) != 0)
		return -1;
	cfg->demo_mode = v;

	if (parse_option_string(uci_path, "pages", cfg->pages, sizeof(cfg->pages)) != 0)
		return -1;
	if (!cfg->pages[0])
		return -1;

	if (parse_option_int(uci_path, "interval_system", &v) != 0 || v <= 0)
		return -1;
	cfg->interval_system_ms = (unsigned)v;

	if (parse_option_int(uci_path, "interval_network", &v) != 0 || v <= 0)
		return -1;
	cfg->interval_network_ms = (unsigned)v;

	if (parse_option_int(uci_path, "push_alerts", &v) != 0)
		return -1;
	cfg->push_alerts = v;

	if (parse_option_int(uci_path, "max_line", &v) != 0 || v < 64)
		return -1;
	cfg->max_line = (unsigned)v;

	return 0;
}

int mcudd_config_load(struct mcudd_config *cfg)
{
	return mcudd_config_load_file(MCUDD_UCI_FILE, cfg);
}
