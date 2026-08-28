/*
 * Host tests for /proc/stat CPU% and RK3588 thermal selection.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
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
	expect(strstr(buf, "\"eth1_role\":\"LAN1\"") != NULL, "eth1 LAN1 label");
	expect(strstr(buf, "\"eth2_role\":\"LAN2\"") != NULL, "eth2 LAN2 label");
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

static void test_clients_dhcp_pool_and_summary(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[768];
	time_t future = time(NULL) + 3600;
	char lease[256];

	setup_base_proc();
	mkdir_p("/tmp");
	write_file("/tmp/dhcp.pool_limit", "150\n");
	snprintf(lease, sizeof(lease),
		 "%lu aa:bb:cc:dd:ee:01 192.168.8.101 phone *\n"
		 "%lu aa:bb:cc:dd:ee:02 192.168.8.102 laptop *\n"
		 "%lu aa:bb:cc:dd:ee:03 192.168.8.103 * *\n"
		 "100 aa:bb:cc:dd:ee:99 192.168.8.199 expired *\n",
		 (unsigned long)future, (unsigned long)future,
		 (unsigned long)future);
	write_file("/tmp/dhcp.leases", lease);

	expect(mcudd_metrics_clients(&cfg, buf, sizeof(buf)) == 0, "clients ok");
	expect(strstr(buf, "\"dhcp_leases\":\"3\"") != NULL, "3 active leases");
	expect(strstr(buf, "\"dhcp_pool\":150") != NULL, "pool 150");
	expect(strstr(buf, "\"dhcp_pct\":2") != NULL, "pct 2 (3/150)");
	expect(strstr(buf, "\"dhcp_summary\":\"phone, laptop, +1\"") != NULL,
	       "summary names");
	expect(strstr(buf, "\"wifi_24\":\"0\"") != NULL, "no AP under sysroot");
	expect(strstr(buf, "\"lan_clients\":\"3\"") != NULL, "lan=leases-wifi");
}

static void write_wireless(const char *body)
{
	mkdir_p("/etc/config");
	write_file("/etc/config/wireless", body);
}

static void setup_wlan0_up(void)
{
	mkdir_p("/sys/class/net/wlan0");
	write_file("/sys/class/net/wlan0/flags", "0x1003\n");
	write_file("/sys/class/net/wlan0/uevent", "INTERFACE=wlan0\n");
}

static void test_wifi_ap_psk2_up(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[768];

	write_wireless(
		"config wifi-device 'radio0'\n"
		"\toption type 'mac80211'\n"
		"\toption disabled '0'\n"
		"\n"
		"config wifi-iface 'default_radio0'\n"
		"\toption device 'radio0'\n"
		"\toption mode 'ap'\n"
		"\toption ssid 'ImmortalCM5'\n"
		"\toption encryption 'psk2'\n"
		"\toption key 'secret'\n"
		"\toption disabled '0'\n"
		"\toption ifname 'wlan0'\n");
	setup_wlan0_up();

	expect(mcudd_metrics_wifi(&cfg, buf, sizeof(buf)) == 0, "wifi psk2");
	expect(strstr(buf, "\"wifi_ssid\":\"ImmortalCM5\"") != NULL, "ssid");
	expect(strstr(buf, "\"wifi_enc\":\"WPA2\"") != NULL, "enc WPA2");
	expect(strstr(buf, "\"wifi_ap_state\":\"up\"") != NULL, "ap up from IFF_UP");
	expect(strstr(buf, "\"wifi_qr\":\"WIFI:T:WPA;S:ImmortalCM5;P:secret;;\"") != NULL,
	       "wpa qr");
}

static void test_wifi_skips_sta_and_disabled(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[768];

	write_wireless(
		"config wifi-device 'radio0'\n"
		"\toption disabled '0'\n"
		"\n"
		"config wifi-iface 'wwan'\n"
		"\toption device 'radio0'\n"
		"\toption mode 'sta'\n"
		"\toption ssid 'Upstream'\n"
		"\toption encryption 'psk2'\n"
		"\toption key 'other'\n"
		"\n"
		"config wifi-iface 'ap'\n"
		"\toption device 'radio0'\n"
		"\toption mode 'ap'\n"
		"\toption ssid 'ImmortalCM5'\n"
		"\toption encryption 'psk2'\n"
		"\toption key 'secret'\n"
		"\toption disabled '1'\n");
	setup_wlan0_up();

	expect(mcudd_metrics_wifi(&cfg, buf, sizeof(buf)) == 0, "wifi disabled");
	expect(strstr(buf, "\"wifi_ssid\":\"ImmortalCM5\"") != NULL, "skip sta ssid");
	expect(strstr(buf, "Upstream") == NULL, "sta ssid not used");
	expect(strstr(buf, "\"wifi_ap_state\":\"disabled\"") != NULL, "uci disabled");
}

static void test_wifi_open_and_sae(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[768];

	write_wireless(
		"config wifi-device 'radio0'\n"
		"\toption disabled '1'\n"
		"\n"
		"config wifi-iface 'ap'\n"
		"\toption device 'radio0'\n"
		"\toption mode 'ap'\n"
		"\toption ssid 'Guest'\n"
		"\toption encryption 'none'\n");
	write_file("/sys/class/net/wlan0/flags", "0x1002\n");

	expect(mcudd_metrics_wifi(&cfg, buf, sizeof(buf)) == 0, "wifi open radio off");
	expect(strstr(buf, "\"wifi_enc\":\"open\"") != NULL, "open label");
	expect(strstr(buf, "\"wifi_ap_state\":\"disabled\"") != NULL, "radio disabled");
	expect(strstr(buf, "WIFI:T:nopass;S:Guest;;") != NULL, "nopass qr");

	write_wireless(
		"config wifi-device 'radio0'\n"
		"\toption disabled '0'\n"
		"\n"
		"config wifi-iface 'ap'\n"
		"\toption device 'radio0'\n"
		"\toption mode 'ap'\n"
		"\toption ssid 'Secure'\n"
		"\toption encryption 'sae'\n"
		"\toption key 'hunter2'\n");
	setup_wlan0_up();
	expect(mcudd_metrics_wifi(&cfg, buf, sizeof(buf)) == 0, "wifi sae");
	expect(strstr(buf, "\"wifi_enc\":\"WPA3\"") != NULL, "sae is WPA3");
	expect(strstr(buf, "WIFI:T:WPA;S:Secure;P:hunter2;;") != NULL,
	       "sae still T:WPA in qr spec");
}

static void test_wifi_qr_escapes_ssid(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[768];

	write_wireless(
		"config wifi-iface 'ap'\n"
		"\toption mode 'ap'\n"
		"\toption ssid 'Cafe;WiFi'\n"
		"\toption encryption 'psk2'\n"
		"\toption key 'p:ass'\n");
	setup_wlan0_up();

	expect(mcudd_metrics_wifi(&cfg, buf, sizeof(buf)) == 0, "wifi escape");
	/* JSON-escaped backslash + QR-escaped semicolon / colon */
	expect(strstr(buf, "S:Cafe\\\\;WiFi") != NULL, "ssid semicolon escaped");
	expect(strstr(buf, "P:p\\\\:ass") != NULL, "key colon escaped");
}

static void test_security_firewall_blocky_vpn(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[512];

	mkdir_p("/etc/config");
	write_file("/etc/config/firewall",
		   "config zone\n"
		   "\toption name 'lan'\n"
		   "\toption input 'ACCEPT'\n"
		   "\toption forward 'ACCEPT'\n"
		   "config zone\n"
		   "\toption name 'wan'\n"
		   "\toption input 'REJECT'\n"
		   "\toption forward 'DROP'\n");
	write_file("/tmp/blocky.blocked", "42\n");
	write_file("/tmp/banip.blocked", "138\n");
	write_file("/tmp/vpn.wg", "1\n");
	write_file("/tmp/vpn.awg", "0\n");
	write_file("/tmp/vpn.tailscale", "Running\n");

	expect(mcudd_metrics_security(&cfg, buf, sizeof(buf)) == 0, "security ok");
	expect(strstr(buf, "\"firewall_state\":\"lan ok · wan Rj/drop\"") != NULL,
	       "firewall zone summary");
	expect(strstr(buf, "\"blocked_24h\":\"42+138\"") != NULL,
	       "blocky+banip blocked");
	expect(strstr(buf, "\"blocky_blocked\":42") != NULL, "blocky count");
	expect(strstr(buf, "\"vpn_tunnels\":\"2 (wg+ts)\"") != NULL,
	       "vpn wg+tailscale");
}

static void test_security_absent_services(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[512];
	char cmd[512];

	snprintf(cmd, sizeof(cmd),
		 "rm -f \"%s/tmp/blocky.blocked\" \"%s/tmp/banip.blocked\" "
		 "\"%s/tmp/vpn.wg\" \"%s/tmp/vpn.awg\" \"%s/tmp/vpn.tailscale\"",
		 g_root, g_root, g_root, g_root, g_root);
	system(cmd);

	mkdir_p("/etc/config");
	write_file("/etc/config/firewall",
		   "config zone\n"
		   "\toption name 'lan'\n"
		   "\toption input 'ACCEPT'\n");
	expect(mcudd_metrics_security(&cfg, buf, sizeof(buf)) == 0,
	       "security minimal firewall");
	expect(strstr(buf, "\"blocked_24h\":\"0\"") != NULL, "no counters");
	expect(strstr(buf, "\"blocky_blocked\":0") != NULL, "blocky zero");
	expect(strstr(buf, "\"banip_blocked\":0") != NULL, "banip zero");
	expect(strstr(buf, "\"vpn_tunnels\":\"0\"") != NULL, "no vpn");
}

static void test_system_hostname_ram_uptime(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[512];

	setup_base_proc();
	write_file("/proc/stat", "cpu  0 0 0 100 0 0 0 0\n");

	mcudd_metrics_reset();
	expect(mcudd_metrics_system(&cfg, buf, sizeof(buf)) == 0, "system fields");
	expect(strstr(buf, "\"uptime_short\":\"1h") != NULL, "uptime from /proc/uptime");
	expect(strstr(buf, "\"ram_used\":\"4000M\"") != NULL, "ram used calc");
	expect(strstr(buf, "\"ram_pct\":50") != NULL, "ram pct 50");
	expect(strstr(buf, "\"load_short\":\"9.99\"") != NULL, "loadavg in system payload");
}

static void test_alarms_empty_and_demo(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[256];

	expect(mcudd_metrics_alarms(&cfg, buf, sizeof(buf)) == 0, "alarms empty");
	expect(strstr(buf, "\"alarms\":[]") != NULL, "empty alarms array");

	cfg.demo_mode = 1;
	expect(mcudd_metrics_alarms(&cfg, buf, sizeof(buf)) == 0, "alarms demo");
	expect(strstr(buf, "Demo") != NULL, "demo alarm label");
}

static void test_metrics_null_guards(void)
{
	struct mcudd_config cfg = dummy_cfg();
	char buf[64];

	expect(mcudd_metrics_system(NULL, buf, sizeof(buf)) != 0, "system null cfg");
	expect(mcudd_metrics_system(&cfg, NULL, sizeof(buf)) != 0, "system null buf");
	expect(mcudd_metrics_network(&cfg, NULL, 0) != 0, "network null buf");
	expect(mcudd_metrics_storage(&cfg, buf, 0) != 0, "storage zero len");
	expect(mcudd_metrics_wifi(&cfg, NULL, sizeof(buf)) != 0, "wifi null buf");
	expect(mcudd_metrics_clients(&cfg, NULL, sizeof(buf)) != 0, "clients null buf");
	expect(mcudd_metrics_security(&cfg, NULL, sizeof(buf)) != 0, "security null buf");
	expect(mcudd_metrics_alarms(&cfg, NULL, sizeof(buf)) != 0, "alarms null buf");
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
	test_clients_dhcp_pool_and_summary();
	test_security_firewall_blocky_vpn();
	test_security_absent_services();
	test_system_hostname_ram_uptime();
	test_alarms_empty_and_demo();
	test_metrics_null_guards();
	test_wifi_ap_psk2_up();
	test_wifi_skips_sta_and_disabled();
	test_wifi_open_and_sae();
	test_wifi_qr_escapes_ssid();

	mcudd_metrics_set_sysroot(NULL);
	snprintf(cmd, sizeof(cmd), "rm -rf \"%s\"", g_root);
	system(cmd);

	printf(tests_failed ? "FAILED\n" : "OK\n");
	return tests_failed ? 1 : 0;
}
