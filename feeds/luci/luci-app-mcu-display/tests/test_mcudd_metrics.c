/*
 * Host tests for /proc/stat CPU% and RK3588 thermal selection.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "mcudd_config.h"
#include "mcudd_metrics.h"

static int tests_failed;
static char g_root[256];

static void expect(int cond, const char *msg)
{
	if (!cond) {
		tests_failed++;
		printf("FAIL: %s\n", msg);
	}
}

static void write_file(const char *rel, const char *body)
{
	char path[384];
	FILE *f;

	snprintf(path, sizeof(path), "%s%s", g_root, rel);
	f = fopen(path, "w");
	if (!f) {
		perror(path);
		exit(1);
	}
	fputs(body, f);
	fclose(f);
}

static void mkdir_p(const char *rel)
{
	char cmd[512];

	snprintf(cmd, sizeof(cmd), "mkdir -p \"%s%s\"", g_root, rel);
	if (system(cmd) != 0)
		exit(1);
}

static struct mcudd_config dummy_cfg(void)
{
	struct mcudd_config cfg;

	memset(&cfg, 0, sizeof(cfg));
	strncpy(cfg.wan_if, "eth0", sizeof(cfg.wan_if) - 1);
	strncpy(cfg.lan_if, "br-lan", sizeof(cfg.lan_if) - 1);
	strncpy(cfg.wifi_if, "wlan0", sizeof(cfg.wifi_if) - 1);
	return cfg;
}

static void setup_base_proc(void)
{
	mkdir_p("/proc");
	write_file("/proc/loadavg", "9.99 9.99 9.99 1/1 1\n");
	write_file("/proc/meminfo", "MemTotal:        8192000 kB\nMemAvailable:    4096000 kB\n");
	write_file("/proc/uptime", "3600.00 0.00\n");
}

static void test_cpu_from_proc_stat_not_loadavg(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[512];

	setup_base_proc();
	/* First snapshot: all idle. busy% must not use loadavg 9.99 → 100. */
	write_file("/proc/stat", "cpu  0 0 0 100 0 0 0 0\n");
	mcudd_metrics_reset();
	expect(mcudd_metrics_system(&cfg, buf, sizeof(buf)) == 0, "system first sample");
	expect(strstr(buf, "\"cpu\":\"0\"") != NULL, "first sample is 0 (baseline)");
	expect(strstr(buf, "\"cpu\":\"99\"") == NULL, "not loadavg proxy on first sample");

	/* +50 busy, +50 idle → 50% utilization */
	write_file("/proc/stat", "cpu  50 0 0 150 0 0 0 0\n");
	expect(mcudd_metrics_system(&cfg, buf, sizeof(buf)) == 0, "system second sample");
	expect(strstr(buf, "\"cpu\":\"50\"") != NULL, "delta busy is 50%");
	expect(strstr(buf, "\"load_short\":\"9.99\"") != NULL, "loadavg still reported separately");
}

static void test_package_thermal_preferred(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[512];

	setup_base_proc();
	write_file("/proc/stat", "cpu  0 0 0 100 0 0 0 0\n");

	mkdir_p("/sys/class/thermal/thermal_zone0");
	mkdir_p("/sys/class/thermal/thermal_zone1");
	write_file("/sys/class/thermal/thermal_zone0/type", "gpu-thermal\n");
	write_file("/sys/class/thermal/thermal_zone0/temp", "80000\n");
	write_file("/sys/class/thermal/thermal_zone1/type", "package-thermal\n");
	write_file("/sys/class/thermal/thermal_zone1/temp", "52000\n");

	mcudd_metrics_reset();
	expect(mcudd_metrics_system(&cfg, buf, sizeof(buf)) == 0, "system with thermal");
	expect(strstr(buf, "\"cpu_temp\":\"52\"") != NULL,
	       "package-thermal 52C wins over hotter gpu");
}

static void test_tsadc_hwmon_fallback(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[512];
	char cmd[512];

	setup_base_proc();
	write_file("/proc/stat", "cpu  0 0 0 100 0 0 0 0\n");
	snprintf(cmd, sizeof(cmd), "rm -rf \"%s/sys/class/thermal\"", g_root);
	system(cmd);

	mkdir_p("/sys/class/hwmon/hwmon0");
	write_file("/sys/class/hwmon/hwmon0/name", "tsadc\n");
	write_file("/sys/class/hwmon/hwmon0/temp1_input", "47000\n");

	mcudd_metrics_reset();
	expect(mcudd_metrics_system(&cfg, buf, sizeof(buf)) == 0, "system with tsadc");
	expect(strstr(buf, "\"cpu_temp\":\"47\"") != NULL, "tsadc hwmon 47C");
}

static void test_temp_missing(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[512];
	char cmd[512];

	setup_base_proc();
	write_file("/proc/stat", "cpu  0 0 0 100 0 0 0 0\n");
	snprintf(cmd, sizeof(cmd), "rm -rf \"%s/sys\"", g_root);
	system(cmd);

	mcudd_metrics_reset();
	expect(mcudd_metrics_system(&cfg, buf, sizeof(buf)) == 0, "system no thermal");
	expect(strstr(buf, "\"cpu_temp\":\"--\"") != NULL, "missing thermal is --");
}

int main(void)
{
	char cmd[512];

	snprintf(g_root, sizeof(g_root), "/tmp/mcudd-metrics-%d", (int)getpid());
	snprintf(cmd, sizeof(cmd), "rm -rf \"%s\" && mkdir -p \"%s\"", g_root, g_root);
	if (system(cmd) != 0)
		return 1;

	mcudd_metrics_set_sysroot(g_root);

	test_cpu_from_proc_stat_not_loadavg();
	test_package_thermal_preferred();
	test_tsadc_hwmon_fallback();
	test_temp_missing();

	mcudd_metrics_set_sysroot(NULL);
	snprintf(cmd, sizeof(cmd), "rm -rf \"%s\"", g_root);
	system(cmd);

	printf(tests_failed ? "FAILED\n" : "OK\n");
	return tests_failed ? 1 : 0;
}
