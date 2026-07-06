/*
 * mcudd_metrics — router metrics from /proc, /sys, UCI (scope payloads).
 */

#define _POSIX_C_SOURCE 200809L

#include "mcudd_metrics.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/statvfs.h>
#include <unistd.h>

static int run_shell(const char *cmd, char *out, size_t len)
{
	FILE *f;

	if (!cmd || !out || !len)
		return -1;
	out[0] = '\0';
	f = popen(cmd, "r");
	if (!f)
		return -1;
	if (!fgets(out, len, f)) {
		pclose(f);
		return -1;
	}
	out[strcspn(out, "\r\n")] = '\0';
	pclose(f);
	return out[0] ? 0 : -1;
}

static int read_proc_loadavg(float *load1)
{
	FILE *f;
	float l1, l5, l15;

	if (!load1)
		return -1;
	f = fopen("/proc/loadavg", "r");
	if (!f)
		return -1;
	if (fscanf(f, "%f %f %f", &l1, &l5, &l15) != 3) {
		fclose(f);
		return -1;
	}
	fclose(f);
	*load1 = l1;
	return 0;
}

static int read_meminfo(unsigned long *total_kb, unsigned long *avail_kb)
{
	char line[128];
	FILE *f;
	unsigned long val;
	char key[32];

	if (!total_kb || !avail_kb)
		return -1;
	*total_kb = 0;
	*avail_kb = 0;

	f = fopen("/proc/meminfo", "r");
	if (!f)
		return -1;

	while (fgets(line, sizeof(line), f)) {
		if (sscanf(line, "%31s %lu", key, &val) != 2)
			continue;
		if (!strcmp(key, "MemTotal:"))
			*total_kb = val;
		else if (!strcmp(key, "MemAvailable:"))
			*avail_kb = val;
	}
	fclose(f);
	return (*total_kb > 0) ? 0 : -1;
}

static int read_uptime_short(char *buf, size_t len)
{
	FILE *f;
	long up = 0;

	if (!buf || !len)
		return -1;
	f = fopen("/proc/uptime", "r");
	if (!f)
		return -1;
	if (fscanf(f, "%ld", &up) != 1) {
		fclose(f);
		return -1;
	}
	fclose(f);
	if (up >= 86400)
		snprintf(buf, len, "%ldd %02ldh", up / 86400, (up % 86400) / 3600);
	else if (up >= 3600)
		snprintf(buf, len, "%ldh %02ldm", up / 3600, (up % 3600) / 60);
	else
		snprintf(buf, len, "%ldm", up / 60);
	return 0;
}

static int count_dhcp_leases(void)
{
	FILE *f;
	char line[256];
	int n = 0;

	f = fopen("/tmp/dhcp.leases", "r");
	if (!f)
		return 0;
	while (fgets(line, sizeof(line), f)) {
		if (line[0] && line[0] != '#')
			n++;
	}
	fclose(f);
	return n;
}

static int iface_carrier(const char *ifname)
{
	char path[128];
	char val[8] = { 0 };
	FILE *f;

	snprintf(path, sizeof(path), "/sys/class/net/%s/carrier", ifname);
	f = fopen(path, "r");
	if (!f)
		return 0;
	if (!fgets(val, sizeof(val), f)) {
		fclose(f);
		return 0;
	}
	fclose(f);
	return val[0] == '1';
}

static int uci_wan_ip(const struct mcudd_config *cfg, char *ip, size_t len)
{
	char cmd[160];

	snprintf(cmd, sizeof(cmd),
		 "ubus call network.interface.%s status 2>/dev/null | "
		 "sed -n 's/.*\"address\":\"\\([^\"]*\\)\".*/\\1/p' | head -1",
		 cfg->wan_if);
	return run_shell(cmd, ip, len);
}

static int uci_wifi_ssid(char *ssid, size_t len)
{
	return run_shell("uci -q get wireless.@wifi-iface[0].ssid 2>/dev/null", ssid, len);
}

static int uci_wifi_key(char *key, size_t len)
{
	return run_shell("uci -q get wireless.@wifi-iface[0].key 2>/dev/null", key, len);
}

int mcudd_metrics_system(const struct mcudd_config *cfg, char *buf, size_t len)
{
	float load1 = 0.0f;
	unsigned long mem_total = 0, mem_avail = 0;
	unsigned ram_pct = 0;
	int cpu_pct;
	char hostname[48] = "";
	char uptime[24] = "";
	char ram_used[16] = "";

	if (!cfg || !buf || !len)
		return -1;

	read_proc_loadavg(&load1);
	read_meminfo(&mem_total, &mem_avail);
	read_uptime_short(uptime, sizeof(uptime));
	run_shell("uci -q get system.@system[0].hostname 2>/dev/null", hostname,
		  sizeof(hostname));

	if (mem_total > 0 && mem_avail <= mem_total) {
		unsigned long used_kb = mem_total - mem_avail;
		ram_pct = (unsigned)((used_kb * 100UL) / mem_total);
		snprintf(ram_used, sizeof(ram_used), "%luM", used_kb / 1024UL);
	}

	cpu_pct = (int)(load1 * 100.0f);
	if (cpu_pct > 100)
		cpu_pct = 100;

	snprintf(buf, len,
		 "{\"hostname\":\"%s\",\"uptime_short\":\"%s\",\"cpu\":\"%d\","
		 "\"cpu_temp\":\"--\",\"ram_pct\":%u,\"ram_used\":\"%s\","
		 "\"load_short\":\"%.2f\"}",
		 hostname, uptime, cpu_pct, ram_pct, ram_used, load1);
	return 0;
}

int mcudd_metrics_network(const struct mcudd_config *cfg, char *buf, size_t len)
{
	char wan_ip[48] = "--";
	int link = 0;

	if (!cfg || !buf || !len)
		return -1;

	if (uci_wan_ip(cfg, wan_ip, sizeof(wan_ip)) != 0)
		snprintf(wan_ip, sizeof(wan_ip), "--");
	link = iface_carrier(cfg->wan_if);

	snprintf(buf, len,
		 "{\"wan_ip\":\"%s\",\"rx_rate\":\"--\",\"tx_rate\":\"--\","
		 "\"ping_ms\":0,\"link_ok\":%s}",
		 wan_ip, link ? "true" : "false");
	return 0;
}

int mcudd_metrics_clients(const struct mcudd_config *cfg, char *buf, size_t len)
{
	int leases = count_dhcp_leases();
	int lan_up = cfg ? iface_carrier(cfg->lan_if) : 0;
	char lan_clients[8];

	(void)cfg;
	snprintf(lan_clients, sizeof(lan_clients), "%d", lan_up ? leases : 0);

	snprintf(buf, len,
		 "{\"wifi_24\":\"0\",\"wifi_5\":\"0\",\"lan_clients\":\"%s\","
		 "\"clients_total\":\"%d\",\"dhcp_leases\":\"%d\",\"dhcp_pct\":%d}",
		 lan_clients, leases, leases, leases > 50 ? 100 : leases * 2);
	return 0;
}

int mcudd_metrics_storage(const struct mcudd_config *cfg, char *buf, size_t len)
{
	struct statvfs st;
	unsigned long long total, free_b;
	unsigned root_pct = 0;
	char root_usage[24];

	(void)cfg;

	if (!buf || !len)
		return -1;

	if (statvfs("/", &st) != 0) {
		snprintf(buf, len,
			 "{\"root_usage\":\"n/a\",\"root_pct\":0,\"data_usage\":\"n/a\","
			 "\"data_pct\":0,\"swap_usage\":\"0\",\"storage\":[]}");
		return 0;
	}

	total = (unsigned long long)st.f_blocks * st.f_frsize;
	free_b = (unsigned long long)st.f_bavail * st.f_frsize;
	if (total > 0)
		root_pct = (unsigned)(100ULL * (total - free_b) / total);
	snprintf(root_usage, sizeof(root_usage), "%u%%", root_pct);

	snprintf(buf, len,
		 "{\"root_usage\":\"%s\",\"root_pct\":%u,\"data_usage\":\"--\","
		 "\"data_pct\":0,\"swap_usage\":\"0\","
		 "\"storage\":[{\"mountpoint\":\"/\",\"used_percent\":\"%u\","
		 "\"free_gb\":\"%.2f\"}]}",
		 root_usage, root_pct, root_pct,
		 free_b / (1024.0 * 1024.0 * 1024.0));
	return 0;
}

int mcudd_metrics_wifi(const struct mcudd_config *cfg, char *buf, size_t len)
{
	char ssid[48] = "";
	char key[64] = "";
	char qr[128] = "";
	char state[16] = "down";
	int up = 0;

	if (!cfg || !buf || !len)
		return -1;

	uci_wifi_ssid(ssid, sizeof(ssid));
	uci_wifi_key(key, sizeof(key));
	up = iface_carrier(cfg->wifi_if);
	snprintf(state, sizeof(state), "%s", up ? "up" : "down");

	if (ssid[0] && key[0])
		snprintf(qr, sizeof(qr), "WIFI:T:WPA;S:%s;P:%s;;", ssid, key);
	else if (ssid[0])
		snprintf(qr, sizeof(qr), "WIFI:S:%s;;", ssid);

	snprintf(buf, len,
		 "{\"wifi_ssid\":\"%s\",\"wifi_ap_state\":\"%s\",\"wifi_qr\":\"%s\"}",
		 ssid, state, qr);
	return 0;
}

int mcudd_metrics_security(const struct mcudd_config *cfg, char *buf, size_t len)
{
	char fw[16] = "off";

	(void)cfg;
	if (run_shell("uci -q get firewall.@defaults[0].syn_flood 2>/dev/null", fw,
		      sizeof(fw)) != 0)
		snprintf(fw, sizeof(fw), "on");

	snprintf(buf, len,
		 "{\"firewall_state\":\"%s\",\"blocked_24h\":\"0\",\"vpn_tunnels\":\"0\"}",
		 fw);
	return 0;
}

int mcudd_metrics_alarms(const struct mcudd_config *cfg, char *buf, size_t len)
{
	if (!cfg || !buf || !len)
		return -1;

	if (cfg->demo_mode) {
		snprintf(buf, len,
			 "{\"alarms\":[{\"time\":\"08:00\",\"label\":\"Demo\","
			 "\"enabled\":true}]}");
		return 0;
	}

	snprintf(buf, len, "{\"alarms\":[]}");
	return 0;
}
