/*
 * oledd_config — minimal UCI read for menu options (Phase 2/3).
 */

#include "oledd_config.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define UCI_FILE "/etc/config/oled"

static int parse_option_int(const char *option, int defval)
{
	char line[160];
	char needle[48];
	FILE *f;

	snprintf(needle, sizeof(needle), "option %s", option);
	f = fopen(UCI_FILE, "r");
	if (!f)
		return defval;

	while (fgets(line, sizeof(line), f)) {
		char *p, *val;

		if (strncmp(line, needle, strlen(needle)) != 0)
			continue;
		p = strchr(line, '\'');
		if (!p) {
			p = strchr(line, '"');
			if (!p)
				continue;
		}
		val = p + 1;
		p = strchr(val, *p == '\'' ? '\'' : '"');
		if (!p)
			continue;
		*p = '\0';
		fclose(f);
		return atoi(val);
	}

	fclose(f);
	return defval;
}

static void parse_option_string(const char *option, const char *defval,
				char *out, size_t len)
{
	char line[160];
	char needle[48];
	FILE *f;

	if (!out || !len)
		return;
	strncpy(out, defval, len - 1);
	out[len - 1] = '\0';

	snprintf(needle, sizeof(needle), "option %s", option);
	f = fopen(UCI_FILE, "r");
	if (!f)
		return;

	while (fgets(line, sizeof(line), f)) {
		char *p, *val;

		if (strncmp(line, needle, strlen(needle)) != 0)
			continue;
		p = strchr(line, '\'');
		if (!p) {
			p = strchr(line, '"');
			if (!p)
				continue;
		}
		val = p + 1;
		p = strchr(val, *p == '\'' ? '\'' : '"');
		if (!p)
			continue;
		*p = '\0';
		strncpy(out, val, len - 1);
		out[len - 1] = '\0';
		fclose(f);
		return;
	}

	fclose(f);
}

int oledd_config_menu_wifi(void)
{
	return parse_option_int("menu_wifi", 1);
}

int oledd_config_menu_interactive(void)
{
	return parse_option_int("menu_interactive", 1);
}

void oledd_config_menu_nav_button(char *out, size_t len)
{
	parse_option_string("menu_nav_button", "BTN_2", out, len);
}

void oledd_config_menu_select_button(char *out, size_t len)
{
	parse_option_string("menu_select_button", "wps", out, len);
}
