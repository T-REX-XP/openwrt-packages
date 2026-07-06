/*
 * Unit tests for mcudd_config (host build).
 */

#include <stdio.h>
#include <string.h>

#include "mcudd_config.h"

static int tests_run;
static int tests_failed;

static void expect(int cond, const char *msg)
{
	tests_run++;
	if (!cond) {
		tests_failed++;
		printf("FAIL: %s\n", msg);
	}
}

static const char *FIXTURE_OK =
	"config mcud 'main'\n"
	"\toption enable '1'\n"
	"\toption path '/dev/ttyUSB1'\n"
	"\toption baud '115200'\n"
	"\toption wire_format 'json'\n"
	"\toption demo_mode '0'\n"
	"\toption pages '/etc/mcud/pages.json'\n"
	"\toption wan_if 'wan'\n"
	"\toption lan_if 'br-lan'\n"
	"\toption wifi_if 'wlan0'\n"
	"\toption interval_system '1000'\n"
	"\toption interval_network '2000'\n"
	"\toption push_alerts '1'\n"
	"\toption max_line '4096'\n"
	"\toption screen_timeout '60'\n"
	"\toption screen_timeout_mode 'off'\n"
	"\toption log_level 'info'\n"
	"\toption debug '0'\n"
	"\toption debug_serial '0'\n";

static const char *FIXTURE_MISSING_PATH =
	"config mcud 'main'\n"
	"\toption enable '1'\n"
	"\toption baud '115200'\n";

static void write_fixture(const char *path, const char *content)
{
	FILE *f = fopen(path, "w");

	if (!f) {
		perror(path);
		tests_failed++;
		return;
	}
	fputs(content, f);
	fclose(f);
}

static void test_load_ok(void)
{
	struct mcudd_config cfg;
	const char *path = "test_mcud_ok.conf";

	write_fixture(path, FIXTURE_OK);
	expect(mcudd_config_load_file(path, &cfg) == 0, "load complete config");
	expect(cfg.enable == 1, "enable");
	expect(!strcmp(cfg.path, "/dev/ttyUSB1"), "path");
	expect(cfg.baud == 115200, "baud");
	expect(!strcmp(cfg.wire_format, "json"), "wire_format");
	expect(!strcmp(cfg.pages, "/etc/mcud/pages.json"), "pages");
	expect(cfg.max_line == 4096, "max_line");
	expect(cfg.screen_timeout == 60, "screen_timeout");
	expect(!strcmp(cfg.screen_timeout_mode, "off"), "screen_timeout_mode");
	expect(cfg.log_level == MCUDD_LOG_INFO, "log_level");
	expect(cfg.debug == 0, "debug");
	expect(cfg.debug_serial == 0, "debug_serial");
	remove(path);
}

static void test_missing_required(void)
{
	struct mcudd_config cfg;
	const char *path = "test_mcud_bad.conf";

	write_fixture(path, FIXTURE_MISSING_PATH);
	expect(mcudd_config_load_file(path, &cfg) != 0, "reject incomplete config");
	remove(path);
}

static void test_invalid_wire_format(void)
{
	struct mcudd_config cfg;
	const char *path = "test_mcud_wire.conf";
	const char *content =
		"config mcud 'main'\n"
		"\toption enable '1'\n"
		"\toption path '/dev/ttyS1'\n"
		"\toption baud '115200'\n"
		"\toption wire_format 'binary'\n"
		"\toption demo_mode '0'\n"
	"\toption pages '/etc/mcud/pages.json'\n"
	"\toption wan_if 'wan'\n"
	"\toption lan_if 'br-lan'\n"
	"\toption wifi_if 'wlan0'\n"
	"\toption interval_system '1000'\n"
		"\toption interval_network '2000'\n"
		"\toption push_alerts '1'\n"
		"\toption max_line '4096'\n"
		"\toption screen_timeout '60'\n"
		"\toption screen_timeout_mode 'off'\n";

	write_fixture(path, content);
	expect(mcudd_config_load_file(path, &cfg) != 0, "reject bad wire_format");
	remove(path);
}

static void test_invalid_screen_timeout_mode(void)
{
	struct mcudd_config cfg;
	const char *path = "test_mcud_timeout_mode.conf";
	const char *content =
		"config mcud 'main'\n"
		"\toption enable '1'\n"
		"\toption path '/dev/ttyS1'\n"
		"\toption baud '115200'\n"
		"\toption wire_format 'json'\n"
		"\toption demo_mode '0'\n"
		"\toption pages '/etc/mcud/pages.json'\n"
		"\toption wan_if 'wan'\n"
		"\toption lan_if 'br-lan'\n"
		"\toption wifi_if 'wlan0'\n"
		"\toption interval_system '1000'\n"
		"\toption interval_network '2000'\n"
		"\toption push_alerts '1'\n"
		"\toption max_line '4096'\n"
		"\toption screen_timeout '30'\n"
		"\toption screen_timeout_mode 'fade'\n";

	write_fixture(path, content);
	expect(mcudd_config_load_file(path, &cfg) != 0, "reject bad screen_timeout_mode");
	remove(path);
}

static void test_invalid_log_level(void)
{
	struct mcudd_config cfg;
	const char *path = "test_mcud_log_level.conf";
	const char *content =
		"config mcud 'main'\n"
		"\toption enable '1'\n"
		"\toption path '/dev/ttyS1'\n"
		"\toption baud '115200'\n"
		"\toption wire_format 'json'\n"
		"\toption demo_mode '0'\n"
		"\toption pages '/etc/mcud/pages.json'\n"
		"\toption wan_if 'wan'\n"
		"\toption lan_if 'br-lan'\n"
		"\toption wifi_if 'wlan0'\n"
		"\toption interval_system '1000'\n"
		"\toption interval_network '2000'\n"
		"\toption push_alerts '1'\n"
		"\toption max_line '4096'\n"
		"\toption screen_timeout '60'\n"
		"\toption screen_timeout_mode 'off'\n"
		"\toption log_level 'trace'\n"
		"\toption debug '0'\n"
		"\toption debug_serial '0'\n";

	write_fixture(path, content);
	expect(mcudd_config_load_file(path, &cfg) != 0, "reject bad log_level");
	remove(path);
}

int main(void)
{
	test_load_ok();
	test_missing_required();
	test_invalid_wire_format();
	test_invalid_screen_timeout_mode();
	test_invalid_log_level();

	printf("Ran %d tests, %d failed\n", tests_run, tests_failed);
	return tests_failed ? 1 : 0;
}
