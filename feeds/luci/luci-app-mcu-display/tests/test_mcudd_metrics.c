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

static void setup_port(const char *ifname, const char *carrier, const char *speed)
{
	char rel[128];

	snprintf(rel, sizeof(rel), "/sys/class/net/%s", ifname);
	mkdir_p(rel);
	snprintf(rel, sizeof(rel), "/sys/class/net/%s/uevent", ifname);
	write_file(rel, "DEVTYPE=ethernet\n");
	snprintf(rel, sizeof(rel), "/sys/class/net/%s/carrier", ifname);
	write_file(rel, carrier);
	snprintf(rel, sizeof(rel), "/sys/class/net/%s/speed", ifname);
	write_file(rel, speed);
}

static void write_net_dev(unsigned long long eth0_rx, unsigned long long eth0_tx)
{
	char body[640];

	snprintf(body, sizeof(body),
		 "Inter-|   Receive                                                |  Transmit\n"
		 " face |bytes    packets errs drop fifo frame compressed multicast|bytes packets\n"
		 "  eth0: %llu 1 0 0 0 0 0 0 %llu 1 0 0 0 0 0 0\n"
		 "  eth1: 10 0 0 0 0 0 0 0 10 0 0 0 0 0 0 0\n"
		 "  eth2: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n",
		 eth0_rx, eth0_tx);
	write_file("/proc/net/dev", body);
}

static void test_network_rates_ports_ping(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[1024];

	strncpy(cfg.wan_if, "wan", sizeof(cfg.wan_if) - 1);
	setup_base_proc();
	mkdir_p("/proc/net");
	setup_port("eth0", "1\n", "2500\n");
	setup_port("eth1", "1\n", "2500\n");
	setup_port("eth2", "0\n", "-1\n");
	write_net_dev(1000ULL, 2000ULL);
	mkdir_p("/tmp");
	write_file("/tmp/mcud_wan_ping", "12.4\n");
	write_file("/proc/net/route",
		   "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\n"
		   "eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\n");

	mcudd_metrics_reset();
	expect(mcudd_metrics_network(&cfg, buf, sizeof(buf)) == 0, "network first");
	expect(strstr(buf, "\"wan_dev\":\"eth0\"") != NULL, "wan logical name resolves to eth0");
	expect(strstr(buf, "\"eth0_role\":\"WAN\"") != NULL, "eth0 WAN label");
	expect(strstr(buf, "\"eth1_role\":\"LAN\"") != NULL, "eth1 LAN label");
	expect(strstr(buf, "\"eth2_role\":\"LAN\"") != NULL, "eth2 LAN label");
	expect(strstr(buf, "\"eth0_up\":true") != NULL, "eth0 up");
	expect(strstr(buf, "\"eth1_up\":true") != NULL, "eth1 up");
	expect(strstr(buf, "\"eth2_up\":false") != NULL, "eth2 down");
	expect(strstr(buf, "\"eth0_speed\":\"2.5G\"") != NULL, "eth0 2.5G");
	expect(strstr(buf, "\"eth1_speed\":\"2.5G\"") != NULL, "eth1 2.5G");
	expect(strstr(buf, "\"ping_ok\":true") != NULL, "cached ping ok");
	expect(strstr(buf, "\"ping_ms\":12") != NULL, "cached ping 12ms");
	expect(strstr(buf, "\"rx_rate\":\"--\"") != NULL, "first sample no rate yet");

	usleep(120000);
	write_net_dev(13000ULL, 5000ULL);
	expect(mcudd_metrics_network(&cfg, buf, sizeof(buf)) == 0, "network second");
	expect(strstr(buf, "\"rx_rate\":\"--\"") == NULL, "second sample has rx rate");
	expect(strstr(buf, "/s\"") != NULL, "rate includes /s");
}

static void test_storage_swap_and_root(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[768];

	setup_base_proc();
	write_file("/proc/meminfo",
		   "MemTotal:        8192000 kB\n"
		   "MemAvailable:    4096000 kB\n"
		   "SwapTotal:        524288 kB\n"
		   "SwapFree:         262144 kB\n");
	/* No mounts fixture → data_kind none; root from live /. */
	mkdir_p("/proc");
	write_file("/proc/mounts",
		   "/dev/root / ext4 rw 0 0\n"
		   "tmpfs /tmp tmpfs rw 0 0\n");

	expect(mcudd_metrics_storage(&cfg, buf, sizeof(buf)) == 0, "storage ok");
	expect(strstr(buf, "\"root_pct\":") != NULL, "root_pct present");
	expect(strstr(buf, "\"root_usage\":\"") != NULL, "root_usage present");
	expect(strstr(buf, "\"swap_usage\":\"off\"") == NULL, "swap not off");
	expect(strstr(buf, "\"swap_pct\":50") != NULL, "swap half used");
	expect(strstr(buf, "\"data_kind\":\"none\"") != NULL, "no data mount");
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
	test_network_rates_ports_ping();
	test_storage_swap_and_root();

	mcudd_metrics_set_sysroot(NULL);
	snprintf(cmd, sizeof(cmd), "rm -rf \"%s\"", g_root);
	system(cmd);

	printf(tests_failed ? "FAILED\n" : "OK\n");
	return tests_failed ? 1 : 0;
}
