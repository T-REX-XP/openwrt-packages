/*
 * mcudd_metrics — router metrics from /proc, /sys, UCI (scope payloads).
 */

#define _POSIX_C_SOURCE 200809L

#include "mcudd_metrics.h"

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/statvfs.h>
#include <unistd.h>

static char g_sysroot[256];
static unsigned long long g_prev_idle, g_prev_total;
static int g_have_cpu_prev;
static int g_last_cpu_pct;

void mcudd_metrics_set_sysroot(const char *root)
{
	size_t n;

	g_sysroot[0] = '\0';
	g_have_cpu_prev = 0;
	g_prev_idle = 0;
	g_prev_total = 0;
	g_last_cpu_pct = 0;
	if (!root || !root[0])
		return;
	n = strlen(root);
	if (n >= sizeof(g_sysroot))
		n = sizeof(g_sysroot) - 1;
	memcpy(g_sysroot, root, n);
	g_sysroot[n] = '\0';
	if (n > 1 && g_sysroot[n - 1] == '/')
		g_sysroot[n - 1] = '\0';
	mcudd_metrics_reset();
}

void mcudd_metrics_reset(void)
{
	g_have_cpu_prev = 0;
	g_prev_idle = 0;
	g_prev_total = 0;
	g_last_cpu_pct = 0;
}

static FILE *fopen_sys(const char *rel, const char *mode)
{
	char path[384];

	if (!rel)
		return NULL;
	if (g_sysroot[0])
		snprintf(path, sizeof(path), "%s%s", g_sysroot, rel);
	else
		snprintf(path, sizeof(path), "%s", rel);
	return fopen(path, mode);
}

static DIR *opendir_sys(const char *rel)
{
	char path[384];

	if (!rel)
		return NULL;
	if (g_sysroot[0])
		snprintf(path, sizeof(path), "%s%s", g_sysroot, rel);
	else
		snprintf(path, sizeof(path), "%s", rel);
	return opendir(path);
}

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
	f = fopen_sys("/proc/loadavg", "r");
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

	f = fopen_sys("/proc/meminfo", "r");
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
	f = fopen_sys("/proc/uptime", "r");
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

/* Aggregate CPU busy % from /proc/stat deltas (not loadavg). */
static int read_proc_stat_totals(unsigned long long *idle_all,
				 unsigned long long *total)
{
	FILE *f;
	unsigned long long user, nice, system, idle, iowait = 0;
	unsigned long long irq = 0, softirq = 0, steal = 0;

	if (!idle_all || !total)
		return -1;
	f = fopen_sys("/proc/stat", "r");
	if (!f)
		return -1;
	if (fscanf(f, "cpu %llu %llu %llu %llu %llu %llu %llu %llu",
		   &user, &nice, &system, &idle, &iowait, &irq, &softirq,
		   &steal) < 4) {
		fclose(f);
		return -1;
	}
	fclose(f);
	*idle_all = idle + iowait;
	*total = *idle_all + user + nice + system + irq + softirq + steal;
	return 0;
}

static int read_cpu_pct(int *pct_out)
{
	unsigned long long idle_all, total, didle, dtotal;
	int pct;

	if (!pct_out)
		return -1;
	if (read_proc_stat_totals(&idle_all, &total) != 0)
		return -1;

	if (!g_have_cpu_prev) {
		g_prev_idle = idle_all;
		g_prev_total = total;
		g_have_cpu_prev = 1;
		g_last_cpu_pct = 0;
		*pct_out = 0;
		return 0;
	}

	didle = idle_all - g_prev_idle;
	dtotal = total - g_prev_total;
	g_prev_idle = idle_all;
	g_prev_total = total;

	if (dtotal == 0)
		pct = g_last_cpu_pct;
	else if (dtotal < didle)
		pct = 0;
	else
		pct = (int)((100ULL * (dtotal - didle)) / dtotal);
	if (pct < 0)
		pct = 0;
	if (pct > 100)
		pct = 100;
	g_last_cpu_pct = pct;
	*pct_out = pct;
	return 0;
}

static int thermal_type_score(const char *type)
{
	if (!type || !type[0])
		return 0;
	/* RK3588: package-thermal (DTS &package_thermal) is the SoC sensor. */
	if (strstr(type, "package"))
		return 120;
	if (strstr(type, "soc"))
		return 110;
	if (strstr(type, "tsadc"))
		return 100;
	if (strstr(type, "bigcore") || strstr(type, "cpu"))
		return 90;
	if (strstr(type, "little") || strstr(type, "center"))
		return 80;
	if (strstr(type, "gpu") || strstr(type, "npu"))
		return 30;
	return 10;
}

static int read_temp_milli_file(const char *path, long *milli)
{
	FILE *f;
	long v = 0;

	if (!path || !milli)
		return -1;
	f = fopen(path, "r");
	if (!f)
		return -1;
	if (fscanf(f, "%ld", &v) != 1) {
		fclose(f);
		return -1;
	}
	fclose(f);
	/* Kernels report millidegrees; some boards report whole °C. */
	if (v > -1000 && v < 200)
		v *= 1000;
	*milli = v;
	return 0;
}

static int read_cpu_temp_c(char *buf, size_t len)
{
	DIR *d;
	struct dirent *de;
	char path[320], type[64];
	long best_milli = 0;
	int best_score = -1;
	FILE *tf;

	if (!buf || !len)
		return -1;
	buf[0] = '\0';

	d = opendir_sys("/sys/class/thermal");
	if (d) {
		while ((de = readdir(d)) != NULL) {
			int score;
			long milli = 0;

			if (strncmp(de->d_name, "thermal_zone", 12) != 0)
				continue;
			snprintf(path, sizeof(path),
				 "%s/sys/class/thermal/%s/type",
				 g_sysroot, de->d_name);
			tf = fopen(path, "r");
			type[0] = '\0';
			if (tf) {
				if (fgets(type, sizeof(type), tf))
					type[strcspn(type, "\r\n")] = '\0';
				fclose(tf);
			}
			score = thermal_type_score(type);
			snprintf(path, sizeof(path),
				 "%s/sys/class/thermal/%s/temp",
				 g_sysroot, de->d_name);
			if (read_temp_milli_file(path, &milli) != 0)
				continue;
			if (milli < 0 || milli > 125000)
				continue;
			if (score > best_score ||
			    (score == best_score && milli > best_milli)) {
				best_score = score;
				best_milli = milli;
			}
		}
		closedir(d);
	}

	if (best_score < 0) {
		d = opendir_sys("/sys/class/hwmon");
		if (d) {
			while ((de = readdir(d)) != NULL) {
				char name[64] = "";
				int i;

				if (strncmp(de->d_name, "hwmon", 5) != 0)
					continue;
				snprintf(path, sizeof(path),
					 "%s/sys/class/hwmon/%s/name",
					 g_sysroot, de->d_name);
				tf = fopen(path, "r");
				if (tf) {
					if (fgets(name, sizeof(name), tf))
						name[strcspn(name, "\r\n")] = '\0';
					fclose(tf);
				}
				for (i = 1; i <= 8; i++) {
					long milli = 0;
					int score = thermal_type_score(name);

					snprintf(path, sizeof(path),
						 "%s/sys/class/hwmon/%s/temp%d_input",
						 g_sysroot, de->d_name, i);
					if (read_temp_milli_file(path, &milli) != 0)
						continue;
					if (milli < 0 || milli > 125000)
						continue;
					if (score > best_score ||
					    (score == best_score &&
					     milli > best_milli)) {
						best_score = score;
						best_milli = milli;
					}
				}
			}
			closedir(d);
		}
	}

	if (best_score < 0)
		return -1;
	snprintf(buf, len, "%ld", best_milli / 1000);
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
	int cpu_pct = 0;
	char hostname[48] = "";
	char uptime[24] = "";
	char ram_used[16] = "";
	char cpu_temp[16] = "--";

	if (!cfg || !buf || !len)
		return -1;

	read_proc_loadavg(&load1);
	if (read_cpu_pct(&cpu_pct) != 0) {
		/* Fallback if /proc/stat unavailable */
		cpu_pct = (int)(load1 * 100.0f);
		if (cpu_pct > 100)
			cpu_pct = 100;
		if (cpu_pct < 0)
			cpu_pct = 0;
	}
	if (read_cpu_temp_c(cpu_temp, sizeof(cpu_temp)) != 0)
		strncpy(cpu_temp, "--", sizeof(cpu_temp) - 1);

	read_meminfo(&mem_total, &mem_avail);
	read_uptime_short(uptime, sizeof(uptime));
	run_shell("uci -q get system.@system[0].hostname 2>/dev/null", hostname,
		  sizeof(hostname));

	if (mem_total > 0 && mem_avail <= mem_total) {
		unsigned long used_kb = mem_total - mem_avail;
		ram_pct = (unsigned)((used_kb * 100UL) / mem_total);
		snprintf(ram_used, sizeof(ram_used), "%luM", used_kb / 1024UL);
	}

	snprintf(buf, len,
		 "{\"hostname\":\"%s\",\"uptime_short\":\"%s\",\"cpu\":\"%d\","
		 "\"cpu_temp\":\"%s\",\"ram_pct\":%u,\"ram_used\":\"%s\","
		 "\"load_short\":\"%.2f\"}",
		 hostname, uptime, cpu_pct, cpu_temp, ram_pct, ram_used, load1);
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
