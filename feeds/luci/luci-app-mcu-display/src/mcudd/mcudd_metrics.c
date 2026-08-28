/*
 * mcudd_metrics — router metrics from /proc, /sys, UCI (scope payloads).
 */

#define _POSIX_C_SOURCE 200809L

#include "mcudd_metrics.h"

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/statvfs.h>
#include <time.h>
#include <unistd.h>

static char g_sysroot[256];
static unsigned long long g_prev_idle, g_prev_total;
static int g_have_cpu_prev;
static int g_last_cpu_pct;

static unsigned long long g_rx_bytes, g_tx_bytes;
static unsigned long g_rate_ms;
static int g_have_rate;
static char g_rx_rate[16] = "--";
static char g_tx_rate[16] = "--";
static int g_ping_ms = -1;
static int g_ping_ok;
static unsigned long g_ping_spawn_ms;

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
	g_have_rate = 0;
	g_rx_bytes = 0;
	g_tx_bytes = 0;
	g_rate_ms = 0;
	g_ping_ms = -1;
	g_ping_ok = 0;
	g_ping_spawn_ms = 0;
	snprintf(g_rx_rate, sizeof(g_rx_rate), "--");
	snprintf(g_tx_rate, sizeof(g_tx_rate), "--");
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

/* Build short hostname list: "phone, pi, +2" */
static void dhcp_lease_summary(char *out, size_t len, int *active_out)
{
	FILE *f;
	char line[256];
	char names[3][24];
	int n = 0, named = 0;
	time_t now = time(NULL);

	if (out && len)
		out[0] = '\0';
	if (active_out)
		*active_out = 0;

	f = fopen_sys("/tmp/dhcp.leases", "r");
	if (!f)
		return;
	while (fgets(line, sizeof(line), f)) {
		unsigned long expiry = 0;
		char mac[32], ip[64], host[64];

		if (line[0] == '#' || !line[0] || line[0] == '\n')
			continue;
		if (sscanf(line, "%lu %31s %63s %63s", &expiry, mac, ip, host) < 3)
			continue;
		if (expiry != 0 && (time_t)expiry < now)
			continue;
		n++;
		if (named < 3 && host[0] && strcmp(host, "*") != 0 &&
		    strcmp(host, "+") != 0) {
			snprintf(names[named], sizeof(names[named]), "%.23s",
				 host);
			named++;
		}
	}
	fclose(f);
	if (active_out)
		*active_out = n;
	if (!out || !len)
		return;
	if (n == 0) {
		snprintf(out, len, "no leases");
		return;
	}
	if (named == 0) {
		snprintf(out, len, "%d leases", n);
		return;
	}
	if (named == 1 && n == 1)
		snprintf(out, len, "%s", names[0]);
	else if (named == 1)
		snprintf(out, len, "%s, +%d", names[0], n - 1);
	else if (named == 2 && n == 2)
		snprintf(out, len, "%s, %s", names[0], names[1]);
	else if (named == 2)
		snprintf(out, len, "%s, %s, +%d", names[0], names[1], n - 2);
	else if (n == 3)
		snprintf(out, len, "%s, %s, %s", names[0], names[1], names[2]);
	else
		snprintf(out, len, "%s, %s, +%d", names[0], names[1], n - 2);
}

static int read_dhcp_pool_size(void)
{
	char limit[24] = "";
	char start[24] = "";
	int lim, st;

	if (g_sysroot[0]) {
		/* Optional fixture: /tmp/dhcp.pool_limit */
		FILE *f = fopen_sys("/tmp/dhcp.pool_limit", "r");
		if (f) {
			if (fgets(limit, sizeof(limit), f))
				limit[strcspn(limit, "\r\n")] = '\0';
			fclose(f);
			lim = atoi(limit);
			if (lim > 0)
				return lim;
		}
		return 150;
	}

	if (run_shell("uci -q get dhcp.lan.limit 2>/dev/null", limit,
		      sizeof(limit)) == 0) {
		lim = atoi(limit);
		if (lim > 0)
			return lim;
	}
	/* Fallback: dhcp-range end-start+1 from generated conf */
	if (run_shell(
		    "sed -n 's/.*dhcp-range=set:lan,[0-9.]*,[0-9.]*\\.\\([0-9]*\\),.*/\\1/p' "
		    "/var/etc/dnsmasq.conf.cfg01411c 2>/dev/null | head -1",
		    limit, sizeof(limit)) == 0 &&
	    run_shell("uci -q get dhcp.lan.start 2>/dev/null", start,
		      sizeof(start)) == 0) {
		lim = atoi(limit);
		st = atoi(start);
		if (lim >= st && st > 0)
			return lim - st + 1;
	}
	return 150;
}

static int wifi_iface_is_ap(const char *ifname)
{
	char cmd[160], mode[32] = "";

	if (!ifname || !ifname[0] || g_sysroot[0])
		return 0;
	snprintf(cmd, sizeof(cmd),
		 "iwinfo '%s' info 2>/dev/null | sed -n 's/.*Mode: *\\([^ ]*\\).*/\\1/p' | head -1",
		 ifname);
	if (run_shell(cmd, mode, sizeof(mode)) != 0)
		return 0;
	return !strcasecmp(mode, "Master") || !strcasecmp(mode, "AP");
}

static int wifi_iface_band_ghz(const char *ifname)
{
	char cmd[160];
	int ch = 0;
	float freq = 0.0f;

	if (!ifname || !ifname[0] || g_sysroot[0])
		return 0;
	snprintf(cmd, sizeof(cmd), "iwinfo '%s' info 2>/dev/null", ifname);
	{
		FILE *f = popen(cmd, "r");
		char line[192];

		if (!f)
			return 0;
		while (fgets(line, sizeof(line), f)) {
			const char *p;

			if ((p = strstr(line, "Channel:")) != NULL) {
				ch = atoi(p + 8);
				if (ch > 0 && ch < 15) {
					pclose(f);
					return 24;
				}
				if (ch >= 15) {
					pclose(f);
					return 5;
				}
			}
			if ((p = strstr(line, "GHz")) != NULL) {
				const char *q = p;

				while (q > line &&
				       (q[-1] == ' ' || q[-1] == '(' ||
					(q[-1] >= '0' && q[-1] <= '9') ||
					q[-1] == '.' || q[-1] == ','))
					q--;
				freq = strtof(q, NULL);
				if (freq >= 2.0f && freq < 3.0f) {
					pclose(f);
					return 24;
				}
				if (freq >= 5.0f) {
					pclose(f);
					return 5;
				}
			}
		}
		pclose(f);
	}
	return 0;
}

static int count_wifi_stations(const char *ifname)
{
	char cmd[160];
	FILE *f;
	char line[192];
	int n = 0;

	if (!ifname || !ifname[0] || g_sysroot[0])
		return 0;
	snprintf(cmd, sizeof(cmd), "iwinfo '%s' assoclist 2>/dev/null", ifname);
	f = popen(cmd, "r");
	if (!f)
		return 0;
	while (fgets(line, sizeof(line), f)) {
		/* MAC line: "AA:BB:CC:DD:EE:FF  -40 dBm ..." */
		unsigned a, b, c, d, e, g;
		if (sscanf(line, "%x:%x:%x:%x:%x:%x", &a, &b, &c, &d, &e, &g) == 6)
			n++;
	}
	pclose(f);
	return n;
}

static void count_wifi_by_band(int *n24, int *n5)
{
	DIR *d;
	struct dirent *de;

	if (n24)
		*n24 = 0;
	if (n5)
		*n5 = 0;
	if (g_sysroot[0])
		return;

	d = opendir("/sys/class/net");
	if (!d)
		return;
	while ((de = readdir(d)) != NULL) {
		int band, sta;

		if (de->d_name[0] == '.')
			continue;
		if (!wifi_iface_is_ap(de->d_name))
			continue;
		band = wifi_iface_band_ghz(de->d_name);
		sta = count_wifi_stations(de->d_name);
		if (band == 24 && n24)
			*n24 += sta;
		else if (band == 5 && n5)
			*n5 += sta;
		else if (n5)
			/* unknown band AP → attribute to 5 GHz card */
			*n5 += sta;
	}
	closedir(d);
}

int mcudd_metrics_clients(const struct mcudd_config *cfg, char *buf, size_t len)
{
	int leases = 0;
	int pool = 150;
	int wifi24 = 0, wifi5 = 0;
	int lan_est;
	int dhcp_pct = 0;
	char summary[80] = "no leases";
	char total_s[32];
	char leases_s[16];
	char lan_s[16];
	char w24[12], w5[12];

	(void)cfg;
	if (!buf || !len)
		return -1;

	dhcp_lease_summary(summary, sizeof(summary), &leases);
	/* Keep JSON-safe (hostnames rarely have quotes; strip anyway). */
	{
		char *p;
		for (p = summary; *p; p++) {
			if (*p == '"' || *p == '\\')
				*p = ' ';
		}
	}
	pool = read_dhcp_pool_size();
	if (pool < 1)
		pool = 150;
	if (leases < 0)
		leases = 0;
	dhcp_pct = (int)((leases * 100LL) / pool);
	if (dhcp_pct > 100)
		dhcp_pct = 100;

	count_wifi_by_band(&wifi24, &wifi5);
	lan_est = leases - wifi24 - wifi5;
	if (lan_est < 0)
		lan_est = 0;

	snprintf(w24, sizeof(w24), "%d", wifi24);
	snprintf(w5, sizeof(w5), "%d", wifi5);
	snprintf(leases_s, sizeof(leases_s), "%d", leases);
	snprintf(lan_s, sizeof(lan_s), "%d", lan_est);
	snprintf(total_s, sizeof(total_s), "%d clients", leases);

	snprintf(buf, len,
		 "{\"wifi_24\":\"%s\",\"wifi_5\":\"%s\",\"lan_clients\":\"%s\","
		 "\"clients_total\":\"%s\",\"dhcp_leases\":\"%s\",\"dhcp_pool\":%d,"
		 "\"dhcp_pct\":%d,\"dhcp_summary\":\"%s\"}",
		 w24, w5, lan_s, total_s, leases_s, pool, dhcp_pct, summary);
	return 0;
}

static unsigned long now_ms(void)
{
	struct timespec ts;

	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (unsigned long)ts.tv_sec * 1000UL +
	       (unsigned long)(ts.tv_nsec / 1000000L);
}

static int netdev_exists(const char *ifname)
{
	char rel[160];
	FILE *f;

	if (!ifname || !ifname[0])
		return 0;
	snprintf(rel, sizeof(rel), "/sys/class/net/%s/uevent", ifname);
	f = fopen_sys(rel, "r");
	if (!f)
		return 0;
	fclose(f);
	return 1;
}

static int iface_carrier(const char *ifname)
{
	char rel[160];
	char val[8] = { 0 };
	FILE *f;

	if (!ifname || !ifname[0])
		return 0;
	snprintf(rel, sizeof(rel), "/sys/class/net/%s/carrier", ifname);
	f = fopen_sys(rel, "r");
	if (!f)
		return 0;
	if (!fgets(val, sizeof(val), f)) {
		fclose(f);
		return 0;
	}
	fclose(f);
	return val[0] == '1';
}

static void format_link_speed(int mbps, char *out, size_t len)
{
	if (!out || !len)
		return;
	if (mbps <= 0) {
		snprintf(out, len, "--");
		return;
	}
	if (mbps >= 1000) {
		if (mbps % 1000)
			snprintf(out, len, "%d.%dG", mbps / 1000, (mbps % 1000) / 100);
		else
			snprintf(out, len, "%dG", mbps / 1000);
		return;
	}
	snprintf(out, len, "%dM", mbps);
}

static void read_link_speed(const char *ifname, char *out, size_t len)
{
	char rel[160];
	FILE *f;
	int mbps = 0;

	snprintf(out, len, "--");
	if (!ifname)
		return;
	snprintf(rel, sizeof(rel), "/sys/class/net/%s/speed", ifname);
	f = fopen_sys(rel, "r");
	if (!f)
		return;
	if (fscanf(f, "%d", &mbps) == 1)
		format_link_speed(mbps, out, len);
	fclose(f);
}

static void resolve_wan_dev(const struct mcudd_config *cfg, char *out, size_t len)
{
	if (!out || !len)
		return;
	out[0] = '\0';
	if (cfg && cfg->wan_if[0] && netdev_exists(cfg->wan_if)) {
		snprintf(out, len, "%s", cfg->wan_if);
		return;
	}
	if (netdev_exists("eth0")) {
		snprintf(out, len, "eth0");
		return;
	}
	snprintf(out, len, "%s", (cfg && cfg->wan_if[0]) ? cfg->wan_if : "eth0");
}

static int read_dev_bytes(const char *ifname, unsigned long long *rx,
			  unsigned long long *tx)
{
	FILE *f;
	char line[320];

	if (!ifname || !rx || !tx)
		return -1;
	f = fopen_sys("/proc/net/dev", "r");
	if (!f)
		return -1;
	while (fgets(line, sizeof(line), f)) {
		char *colon, *name;
		unsigned long long r = 0, t = 0;

		colon = strchr(line, ':');
		if (!colon)
			continue;
		*colon = '\0';
		name = line;
		while (*name == ' ' || *name == '\t')
			name++;
		if (strcmp(name, ifname) != 0)
			continue;
		if (sscanf(colon + 1,
			   "%llu %*u %*u %*u %*u %*u %*u %*u %llu",
			   &r, &t) != 2) {
			fclose(f);
			return -1;
		}
		*rx = r;
		*tx = t;
		fclose(f);
		return 0;
	}
	fclose(f);
	return -1;
}

static void format_bps(unsigned long long bps, char *out, size_t len)
{
	if (bps >= 1000000000ULL)
		snprintf(out, len, "%.1fG/s", bps / 1000000000.0);
	else if (bps >= 1000000ULL)
		snprintf(out, len, "%.1fM/s", bps / 1000000.0);
	else if (bps >= 1000ULL)
		snprintf(out, len, "%.1fK/s", bps / 1000.0);
	else
		snprintf(out, len, "%lluB/s", bps);
}

static void update_wan_rates(const char *wan_dev)
{
	unsigned long long rx = 0, tx = 0, now, dt;
	unsigned long long drx, dtx;

	if (read_dev_bytes(wan_dev, &rx, &tx) != 0)
		return;
	now = now_ms();
	if (!g_have_rate) {
		g_rx_bytes = rx;
		g_tx_bytes = tx;
		g_rate_ms = now;
		g_have_rate = 1;
		return;
	}
	dt = now - g_rate_ms;
	if (dt < 50)
		return;
	drx = (rx >= g_rx_bytes) ? (rx - g_rx_bytes) : 0;
	dtx = (tx >= g_tx_bytes) ? (tx - g_tx_bytes) : 0;
	format_bps((drx * 1000ULL) / dt, g_rx_rate, sizeof(g_rx_rate));
	format_bps((dtx * 1000ULL) / dt, g_tx_rate, sizeof(g_tx_rate));
	g_rx_bytes = rx;
	g_tx_bytes = tx;
	g_rate_ms = now;
}

static int read_default_gw(char *out, size_t len)
{
	FILE *f;
	char line[256], iface[32], dest[16], gw[16];
	unsigned flags = 0;

	if (!out || !len)
		return -1;
	out[0] = '\0';
	f = fopen_sys("/proc/net/route", "r");
	if (!f)
		return -1;
	if (!fgets(line, sizeof(line), f)) {
		fclose(f);
		return -1;
	}
	while (fgets(line, sizeof(line), f)) {
		unsigned long gwv;

		if (sscanf(line, "%31s %15s %15s %x", iface, dest, gw, &flags) < 4)
			continue;
		if (strcmp(dest, "00000000") != 0)
			continue;
		if (!(flags & 0x2))
			continue;
		gwv = strtoul(gw, NULL, 16);
		if (!gwv)
			continue;
		snprintf(out, len, "%lu.%lu.%lu.%lu",
			 gwv & 0xffUL, (gwv >> 8) & 0xffUL,
			 (gwv >> 16) & 0xffUL, (gwv >> 24) & 0xffUL);
		fclose(f);
		return 0;
	}
	fclose(f);
	return -1;
}

static void read_cached_ping(void)
{
	FILE *f;
	char line[64];
	double ms = 0;

	f = fopen_sys("/tmp/mcud_wan_ping", "r");
	if (!f)
		return;
	if (!fgets(line, sizeof(line), f)) {
		fclose(f);
		return;
	}
	fclose(f);
	if (!strncmp(line, "fail", 4) || line[0] == '\0') {
		g_ping_ok = 0;
		g_ping_ms = -1;
		return;
	}
	ms = strtod(line, NULL);
	if (ms < 0)
		ms = 0;
	g_ping_ms = (int)(ms + 0.5);
	g_ping_ok = 1;
}

static void maybe_spawn_ping(int wan_up)
{
	char gw[32] = "";
	char cmd[256];
	unsigned long now;
	const char *target = "1.1.1.1";

	if (g_sysroot[0])
		return;
	if (!wan_up)
		return;
	now = now_ms();
	if (g_ping_spawn_ms && (now - g_ping_spawn_ms) < 8000UL)
		return;
	if (read_default_gw(gw, sizeof(gw)) == 0 && gw[0])
		target = gw;
	snprintf(cmd, sizeof(cmd),
		 "(ping -c 1 -W 1 -n %s 2>/dev/null | "
		 "sed -n 's/.*time=\\([0-9.]*\\).*/\\1/p' | head -1 | "
		 "tee /tmp/mcud_wan_ping >/dev/null; "
		 "test -s /tmp/mcud_wan_ping || echo fail > /tmp/mcud_wan_ping) &",
		 target);
	if (system(cmd) == -1)
		return;
	g_ping_spawn_ms = now;
}

static void format_port_json(const char *ifname, const char *role,
			     char *up, size_t up_len, char *speed, size_t sp_len)
{
	int exists = netdev_exists(ifname);
	int upv = exists && iface_carrier(ifname);

	snprintf(up, up_len, "%s", upv ? "true" : "false");
	if (!upv) {
		snprintf(speed, sp_len, "--");
		return;
	}
	read_link_speed(ifname, speed, sp_len);
	(void)role;
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

static int iface_iff_up(const char *ifname)
{
	char rel[160];
	char val[24] = { 0 };
	FILE *f;
	unsigned long flags;

	if (!ifname || !ifname[0])
		return 0;
	snprintf(rel, sizeof(rel), "/sys/class/net/%s/flags", ifname);
	f = fopen_sys(rel, "r");
	if (!f)
		return 0;
	if (!fgets(val, sizeof(val), f)) {
		fclose(f);
		return 0;
	}
	fclose(f);
	flags = strtoul(val, NULL, 0);
	return (flags & 1UL) != 0; /* IFF_UP — AP carrier is often 0 with no clients */
}

static char *ltrim(char *s)
{
	while (s && (*s == ' ' || *s == '\t'))
		s++;
	return s;
}

static void rstrip_line(char *s)
{
	size_t n;

	if (!s)
		return;
	n = strlen(s);
	while (n && (s[n - 1] == '\n' || s[n - 1] == '\r' || s[n - 1] == ' ' ||
		     s[n - 1] == '\t'))
		s[--n] = '\0';
}

static int parse_uci_option(const char *s, char *name, size_t nlen, char *val,
			    size_t vlen)
{
	size_t i = 0;

	if (!s || !name || !nlen || !val || !vlen)
		return -1;
	name[0] = '\0';
	val[0] = '\0';
	while (*s && *s != ' ' && *s != '\t' && i + 1 < nlen)
		name[i++] = *s++;
	name[i] = '\0';
	while (*s == ' ' || *s == '\t')
		s++;
	if (*s == '\'' || *s == '"') {
		char q = *s++;

		i = 0;
		while (*s && *s != q && i + 1 < vlen)
			val[i++] = *s++;
		val[i] = '\0';
	} else {
		i = 0;
		while (*s && *s != ' ' && *s != '\t' && *s != '#' && i + 1 < vlen)
			val[i++] = *s++;
		val[i] = '\0';
	}
	return name[0] ? 0 : -1;
}

static int parse_uci_config(const char *s, char *stype, size_t slen, char *sname,
			    size_t nlen)
{
	size_t i = 0;

	if (!s || !stype || !slen || !sname || !nlen)
		return -1;
	stype[0] = '\0';
	sname[0] = '\0';
	while (*s && *s != ' ' && *s != '\t' && i + 1 < slen)
		stype[i++] = *s++;
	stype[i] = '\0';
	while (*s == ' ' || *s == '\t')
		s++;
	if (*s == '\'' || *s == '"') {
		char q = *s++;

		i = 0;
		while (*s && *s != q && i + 1 < nlen)
			sname[i++] = *s++;
		sname[i] = '\0';
	} else {
		i = 0;
		while (*s && *s != ' ' && *s != '\t' && *s != '#' && i + 1 < nlen)
			sname[i++] = *s++;
		sname[i] = '\0';
	}
	return stype[0] ? 0 : -1;
}

struct wifi_ap {
	char ssid[48];
	char key[64];
	char encryption[32];
	char disabled[8];
	char mode[16];
	char ifname[16];
	char device[32];
};

struct wifi_radio {
	char name[32];
	char disabled[8];
};

static int wifi_is_ap_mode(const char *mode)
{
	return !mode || !mode[0] || !strcmp(mode, "ap");
}

static int uci_truthy(const char *v)
{
	return v && v[0] &&
	       (!strcmp(v, "1") || !strcmp(v, "true") || !strcmp(v, "yes") ||
		!strcmp(v, "on"));
}

static int wifi_enc_open(const char *enc)
{
	return !enc || !enc[0] || !strcmp(enc, "none") || !strcmp(enc, "open");
}

static void wifi_enc_label(const char *enc, char *out, size_t len)
{
	if (!out || !len)
		return;
	if (wifi_enc_open(enc))
		snprintf(out, len, "open");
	else if (strstr(enc, "sae-mixed") || strstr(enc, "psk-sae"))
		snprintf(out, len, "WPA2/3");
	else if (strstr(enc, "sae"))
		snprintf(out, len, "WPA3");
	else if (strstr(enc, "psk-mixed"))
		snprintf(out, len, "WPA/WPA2");
	else if (strstr(enc, "psk2"))
		snprintf(out, len, "WPA2");
	else if (strstr(enc, "psk"))
		snprintf(out, len, "WPA");
	else if (strstr(enc, "wep"))
		snprintf(out, len, "WEP");
	else
		snprintf(out, len, "%.15s", enc);
}

static void wifi_qr_escape(const char *in, char *out, size_t len)
{
	size_t o = 0;

	if (!out || !len)
		return;
	out[0] = '\0';
	for (; in && *in && o + 2 < len; in++) {
		if (*in == '\\' || *in == ';' || *in == ',' || *in == ':') {
			out[o++] = '\\';
			out[o++] = *in;
		} else if (*in != '"' && (unsigned char)*in >= 0x20) {
			out[o++] = *in;
		}
	}
	out[o] = '\0';
}

static void wifi_build_qr(const char *ssid, const char *key, const char *enc,
			  char *qr, size_t len)
{
	char s[96], p[128];

	if (!qr || !len)
		return;
	qr[0] = '\0';
	if (!ssid || !ssid[0])
		return;
	wifi_qr_escape(ssid, s, sizeof(s));
	if (wifi_enc_open(enc)) {
		snprintf(qr, len, "WIFI:T:nopass;S:%s;;", s);
		return;
	}
	wifi_qr_escape(key ? key : "", p, sizeof(p));
	snprintf(qr, len, "WIFI:T:WPA;S:%s;P:%s;;", s, p);
}

static void json_escape(const char *in, char *out, size_t len)
{
	size_t o = 0;

	if (!out || !len)
		return;
	out[0] = '\0';
	for (; in && *in && o + 2 < len; in++) {
		if (*in == '\\' || *in == '"') {
			out[o++] = '\\';
			out[o++] = *in;
		} else if ((unsigned char)*in >= 0x20) {
			out[o++] = *in;
		}
	}
	out[o] = '\0';
}

static int parse_wireless_file(struct wifi_ap *ap, char *radio_disabled,
			       size_t rdlen)
{
	FILE *f;
	char line[320];
	char stype[32], sname[32], opt[32], val[96];
	struct wifi_ap cur;
	struct wifi_radio radios[4];
	int nradio = 0, in_iface = 0, in_device = 0, have_ap = 0, i;

	if (!ap)
		return -1;
	memset(ap, 0, sizeof(*ap));
	if (radio_disabled && rdlen)
		radio_disabled[0] = '\0';
	memset(radios, 0, sizeof(radios));
	memset(&cur, 0, sizeof(cur));

	f = fopen_sys("/etc/config/wireless", "r");
	if (!f)
		return -1;

	while (fgets(line, sizeof(line), f)) {
		char *s = ltrim(line);

		rstrip_line(s);
		if (!s[0] || s[0] == '#')
			continue;
		if (!strncmp(s, "config ", 7)) {
			if (in_iface && !have_ap && wifi_is_ap_mode(cur.mode) &&
			    cur.ssid[0]) {
				*ap = cur;
				have_ap = 1;
			}
			in_iface = 0;
			in_device = 0;
			memset(&cur, 0, sizeof(cur));
			if (parse_uci_config(ltrim(s + 7), stype, sizeof(stype),
					     sname, sizeof(sname)) != 0)
				continue;
			if (!strcmp(stype, "wifi-iface"))
				in_iface = 1;
			else if (!strcmp(stype, "wifi-device") &&
				 nradio < (int)(sizeof(radios) / sizeof(radios[0]))) {
				in_device = 1;
				snprintf(radios[nradio].name,
					 sizeof(radios[nradio].name), "%s",
					 sname);
				nradio++;
			}
			continue;
		}
		if (strncmp(s, "option ", 7) != 0)
			continue;
		if (parse_uci_option(ltrim(s + 7), opt, sizeof(opt), val,
				     sizeof(val)) != 0)
			continue;
		if (in_iface) {
			if (!strcmp(opt, "ssid"))
				snprintf(cur.ssid, sizeof(cur.ssid), "%s", val);
			else if (!strcmp(opt, "key"))
				snprintf(cur.key, sizeof(cur.key), "%s", val);
			else if (!strcmp(opt, "encryption"))
				snprintf(cur.encryption, sizeof(cur.encryption),
					 "%s", val);
			else if (!strcmp(opt, "disabled"))
				snprintf(cur.disabled, sizeof(cur.disabled),
					 "%s", val);
			else if (!strcmp(opt, "mode"))
				snprintf(cur.mode, sizeof(cur.mode), "%s", val);
			else if (!strcmp(opt, "ifname"))
				snprintf(cur.ifname, sizeof(cur.ifname), "%s",
					 val);
			else if (!strcmp(opt, "device"))
				snprintf(cur.device, sizeof(cur.device), "%s",
					 val);
		} else if (in_device && nradio > 0 && !strcmp(opt, "disabled")) {
			snprintf(radios[nradio - 1].disabled,
				 sizeof(radios[nradio - 1].disabled), "%s",
				 val);
		}
	}
	if (in_iface && !have_ap && wifi_is_ap_mode(cur.mode) && cur.ssid[0]) {
		*ap = cur;
		have_ap = 1;
	}
	fclose(f);

	if (radio_disabled && rdlen && have_ap) {
		for (i = 0; i < nradio; i++) {
			if (ap->device[0] &&
			    !strcmp(ap->device, radios[i].name)) {
				snprintf(radio_disabled, rdlen, "%s",
					 radios[i].disabled);
				break;
			}
		}
		if (!radio_disabled[0] && nradio > 0 && !ap->device[0])
			snprintf(radio_disabled, rdlen, "%s",
				 radios[0].disabled);
	}
	return have_ap ? 0 : -1;
}

static int wifi_live_opt(const char *opt, char *out, size_t len)
{
	char cmd[192];

	if (g_sysroot[0])
		return -1;
	snprintf(cmd, sizeof(cmd),
		 "uci -q get wireless.@wifi-iface[0].%s 2>/dev/null", opt);
	return run_shell(cmd, out, len);
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
	char wan_dev[32] = "eth0";
	char e0_up[8] = "false", e1_up[8] = "false", e2_up[8] = "false";
	char e0_sp[12] = "--", e1_sp[12] = "--", e2_sp[12] = "--";
	int wan_up;

	if (!cfg || !buf || !len)
		return -1;

	resolve_wan_dev(cfg, wan_dev, sizeof(wan_dev));
	if (uci_wan_ip(cfg, wan_ip, sizeof(wan_ip)) != 0)
		snprintf(wan_ip, sizeof(wan_ip), "--");

	wan_up = iface_carrier(wan_dev);
	update_wan_rates(wan_dev);
	read_cached_ping();
	maybe_spawn_ping(wan_up);

	format_port_json("eth0", "WAN", e0_up, sizeof(e0_up), e0_sp, sizeof(e0_sp));
	format_port_json("eth1", "LAN", e1_up, sizeof(e1_up), e1_sp, sizeof(e1_sp));
	format_port_json("eth2", "LAN", e2_up, sizeof(e2_up), e2_sp, sizeof(e2_sp));

	snprintf(buf, len,
		 "{\"wan_ip\":\"%s\",\"wan_dev\":\"%s\",\"rx_rate\":\"%s\","
		 "\"tx_rate\":\"%s\",\"ping_ms\":%d,\"ping_ok\":%s,"
		 "\"eth0_role\":\"WAN\",\"eth0_up\":%s,\"eth0_speed\":\"%s\","
		 "\"eth1_role\":\"LAN\",\"eth1_up\":%s,\"eth1_speed\":\"%s\","
		 "\"eth2_role\":\"LAN\",\"eth2_up\":%s,\"eth2_speed\":\"%s\","
		 "\"link_ok\":%s}",
		 wan_ip, wan_dev, g_rx_rate, g_tx_rate, g_ping_ms,
		 g_ping_ok ? "true" : "false",
		 e0_up, e0_sp, e1_up, e1_sp, e2_up, e2_sp,
		 wan_up ? "true" : "false");
	return 0;
}

static void human_bytes(unsigned long long bytes, char *buf, size_t len)
{
	if (!buf || !len)
		return;
	if (bytes >= (100ULL << 30))
		snprintf(buf, len, "%lluG", bytes >> 30);
	else if (bytes >= (1ULL << 30))
		snprintf(buf, len, "%.1fG",
			 bytes / (1024.0 * 1024.0 * 1024.0));
	else if (bytes >= (1ULL << 20))
		snprintf(buf, len, "%lluM", (bytes + (1ULL << 19)) >> 20);
	else
		snprintf(buf, len, "%lluK", (bytes + 512ULL) >> 10);
}

static void short_dev(const char *dev, char *out, size_t len)
{
	const char *p;

	if (!out || !len)
		return;
	out[0] = '\0';
	if (!dev || !dev[0])
		return;
	p = strrchr(dev, '/');
	p = p ? p + 1 : dev;
	snprintf(out, len, "%.23s", p);
}

static int vfs_usage(const char *path, unsigned *pct_out, char *usage,
		     size_t usage_len, unsigned long long *total_out,
		     unsigned long long *free_out)
{
	struct statvfs st;
	unsigned long long total, free_b, used;
	char used_s[16], total_s[16];
	unsigned pct = 0;

	if (!path || !pct_out || !usage || !usage_len)
		return -1;
	if (statvfs(path, &st) != 0)
		return -1;
	total = (unsigned long long)st.f_blocks * (unsigned long long)st.f_frsize;
	free_b = (unsigned long long)st.f_bavail * (unsigned long long)st.f_frsize;
	if (total == 0)
		return -1;
	used = total > free_b ? total - free_b : 0;
	pct = (unsigned)((100ULL * used) / total);
	if (pct > 100)
		pct = 100;
	human_bytes(used, used_s, sizeof(used_s));
	human_bytes(total, total_s, sizeof(total_s));
	snprintf(usage, usage_len, "%s/%s", used_s, total_s);
	*pct_out = pct;
	if (total_out)
		*total_out = total;
	if (free_out)
		*free_out = free_b;
	return 0;
}

static int fs_ignored(const char *fstype)
{
	if (!fstype || !fstype[0])
		return 1;
	return !strcmp(fstype, "tmpfs") || !strcmp(fstype, "proc") ||
	       !strcmp(fstype, "sysfs") || !strcmp(fstype, "devpts") ||
	       !strcmp(fstype, "cgroup") || !strcmp(fstype, "cgroup2") ||
	       !strcmp(fstype, "debugfs") || !strcmp(fstype, "bpf") ||
	       !strcmp(fstype, "pstore") || !strcmp(fstype, "ramfs") ||
	       !strcmp(fstype, "devtmpfs");
}

static int read_swap(char *usage, size_t usage_len, unsigned *pct_out)
{
	FILE *f;
	char line[128], key[32];
	unsigned long total_kb = 0, free_kb = 0, val;
	unsigned long long total_b, used_b;
	char used_s[16], total_s[16];
	unsigned pct = 0;

	if (!usage || !usage_len || !pct_out)
		return -1;
	snprintf(usage, usage_len, "off");
	*pct_out = 0;

	f = fopen_sys("/proc/meminfo", "r");
	if (!f)
		return -1;
	while (fgets(line, sizeof(line), f)) {
		if (sscanf(line, "%31s %lu", key, &val) != 2)
			continue;
		if (!strcmp(key, "SwapTotal:"))
			total_kb = val;
		else if (!strcmp(key, "SwapFree:"))
			free_kb = val;
	}
	fclose(f);

	if (total_kb == 0)
		return 0;
	if (free_kb > total_kb)
		free_kb = total_kb;
	total_b = (unsigned long long)total_kb * 1024ULL;
	used_b = (unsigned long long)(total_kb - free_kb) * 1024ULL;
	pct = (unsigned)((100ULL * used_b) / total_b);
	if (pct > 100)
		pct = 100;
	human_bytes(used_b, used_s, sizeof(used_s));
	human_bytes(total_b, total_s, sizeof(total_s));
	snprintf(usage, usage_len, "%s/%s", used_s, total_s);
	*pct_out = pct;
	return 0;
}

/*
 * Prefer OpenWrt /overlay (or extroot), else largest non-root block mount
 * (typically eMMC on CM5 at /mnt/mmcblk0p1).
 */
static int find_data_mount(char *mp_out, size_t mp_len, char *kind_out,
			   size_t kind_len, char *dev_out, size_t dev_len)
{
	FILE *f;
	char line[512], dev[128], mp[160], fstype[64], opts[256];
	char root_dev[128] = "";
	char best_mp[160] = "";
	char best_dev[128] = "";
	char best_kind[16] = "data";
	int best_score = -1;
	unsigned long long best_total = 0;

	if (!mp_out || !mp_len || !kind_out || !kind_len || !dev_out ||
	    !dev_len)
		return -1;
	mp_out[0] = '\0';
	dev_out[0] = '\0';
	/* Leave kind_out unchanged on failure (caller default is "none"). */

	f = fopen_sys("/proc/mounts", "r");
	if (!f)
		return -1;

	while (fgets(line, sizeof(line), f)) {
		if (sscanf(line, "%127s %159s %63s %255s", dev, mp, fstype,
			   opts) < 3)
			continue;
		if (!strcmp(mp, "/"))
			snprintf(root_dev, sizeof(root_dev), "%s", dev);
	}
	rewind(f);

	while (fgets(line, sizeof(line), f)) {
		unsigned long long total = 0;
		unsigned pct = 0;
		char usage[32];
		const char *kind = "data";
		int score = 0;

		if (sscanf(line, "%127s %159s %63s %255s", dev, mp, fstype,
			   opts) < 3)
			continue;
		if (!strcmp(mp, "/"))
			continue;
		if (fs_ignored(fstype) || !strcmp(fstype, "overlay"))
			continue;
		if (root_dev[0] && !strcmp(dev, root_dev))
			continue;
		if (vfs_usage(mp, &pct, usage, sizeof(usage), &total, NULL) != 0)
			continue;
		if (total < (8ULL << 20))
			continue;

		if (!strcmp(mp, "/overlay") || !strncmp(mp, "/overlay/", 9)) {
			kind = strstr(opts, "extroot") ? "extroot" : "overlay";
			score = 400;
		} else if (strstr(mp, "extroot") || strstr(opts, "extroot")) {
			kind = "extroot";
			score = 380;
		} else if (strstr(dev, "mmcblk0")) {
			kind = "emmc";
			score = 200;
		} else if (strstr(dev, "mmcblk")) {
			kind = "sd";
			score = 150;
		} else if (strstr(dev, "sd") || strstr(dev, "nvme") ||
			   strstr(dev, "vd") || strstr(dev, "hd")) {
			kind = "disk";
			score = 120;
		} else {
			continue;
		}

		if (score > best_score ||
		    (score == best_score && total > best_total)) {
			best_score = score;
			best_total = total;
			snprintf(best_mp, sizeof(best_mp), "%s", mp);
			snprintf(best_dev, sizeof(best_dev), "%s", dev);
			snprintf(best_kind, sizeof(best_kind), "%s", kind);
		}
	}
	fclose(f);

	if (!best_mp[0])
		return -1;
	snprintf(mp_out, mp_len, "%s", best_mp);
	snprintf(kind_out, kind_len, "%s", best_kind);
	short_dev(best_dev, dev_out, dev_len);
	return 0;
}

int mcudd_metrics_storage(const struct mcudd_config *cfg, char *buf, size_t len)
{
	unsigned root_pct = 0, data_pct = 0, swap_pct = 0;
	unsigned long long root_free = 0;
	char root_usage[32] = "n/a";
	char data_usage[32] = "none";
	char swap_usage[36] = "off";
	char data_kind[16] = "none";
	char overlay_dev[32] = "";
	char data_mp[160] = "";
	char root_dev[32] = "";

	(void)cfg;

	if (!buf || !len)
		return -1;

	if (vfs_usage("/", &root_pct, root_usage, sizeof(root_usage), NULL,
		      &root_free) != 0) {
		snprintf(root_usage, sizeof(root_usage), "n/a");
		root_pct = 0;
	} else {
		FILE *mf = fopen_sys("/proc/mounts", "r");
		if (mf) {
			char line[512], dev[128], mp[160];

			while (fgets(line, sizeof(line), mf)) {
				if (sscanf(line, "%127s %159s", dev, mp) == 2 &&
				    !strcmp(mp, "/")) {
					short_dev(dev, root_dev,
						  sizeof(root_dev));
					break;
				}
			}
			fclose(mf);
		}
	}

	if (find_data_mount(data_mp, sizeof(data_mp), data_kind,
			    sizeof(data_kind), overlay_dev,
			    sizeof(overlay_dev)) == 0) {
		if (vfs_usage(data_mp, &data_pct, data_usage, sizeof(data_usage),
			      NULL, NULL) != 0) {
			snprintf(data_usage, sizeof(data_usage), "n/a");
			data_pct = 0;
			snprintf(data_kind, sizeof(data_kind), "none");
			overlay_dev[0] = '\0';
		}
	}

	read_swap(swap_usage, sizeof(swap_usage), &swap_pct);

	snprintf(buf, len,
		 "{\"root_usage\":\"%s\",\"root_pct\":%u,\"root_dev\":\"%s\","
		 "\"data_usage\":\"%s\",\"data_pct\":%u,\"data_kind\":\"%s\","
		 "\"overlay_dev\":\"%s\",\"swap_usage\":\"%s\",\"swap_pct\":%u,"
		 "\"storage\":[{\"mountpoint\":\"/\",\"used_percent\":\"%u\","
		 "\"free_gb\":\"%.2f\"}]}",
		 root_usage, root_pct, root_dev, data_usage, data_pct, data_kind,
		 overlay_dev, swap_usage, swap_pct, root_pct,
		 root_free / (1024.0 * 1024.0 * 1024.0));
	return 0;
}

int mcudd_metrics_wifi(const struct mcudd_config *cfg, char *buf, size_t len)
{
	struct wifi_ap ap;
	char radio_dis[8] = "";
	char ifname[32] = "";
	char enc_lbl[16] = "open";
	char state[16] = "down";
	char qr[160] = "";
	char ssid_j[96], enc_j[32], state_j[24], qr_j[192];

	if (!cfg || !buf || !len)
		return -1;

	memset(&ap, 0, sizeof(ap));
	if (parse_wireless_file(&ap, radio_dis, sizeof(radio_dis)) != 0 &&
	    !g_sysroot[0]) {
		wifi_live_opt("ssid", ap.ssid, sizeof(ap.ssid));
		wifi_live_opt("key", ap.key, sizeof(ap.key));
		wifi_live_opt("encryption", ap.encryption, sizeof(ap.encryption));
		wifi_live_opt("disabled", ap.disabled, sizeof(ap.disabled));
		wifi_live_opt("ifname", ap.ifname, sizeof(ap.ifname));
		run_shell("uci -q get wireless.@wifi-device[0].disabled 2>/dev/null",
			  radio_dis, sizeof(radio_dis));
	}

	if (ap.ifname[0])
		snprintf(ifname, sizeof(ifname), "%s", ap.ifname);
	else
		snprintf(ifname, sizeof(ifname), "%s", cfg->wifi_if);

	wifi_enc_label(ap.encryption, enc_lbl, sizeof(enc_lbl));
	if (uci_truthy(ap.disabled) || uci_truthy(radio_dis))
		snprintf(state, sizeof(state), "disabled");
	else if (iface_iff_up(ifname))
		snprintf(state, sizeof(state), "up");
	else
		snprintf(state, sizeof(state), "down");

	wifi_build_qr(ap.ssid, ap.key, ap.encryption, qr, sizeof(qr));

	json_escape(ap.ssid, ssid_j, sizeof(ssid_j));
	json_escape(enc_lbl, enc_j, sizeof(enc_j));
	json_escape(state, state_j, sizeof(state_j));
	json_escape(qr, qr_j, sizeof(qr_j));

	snprintf(buf, len,
		 "{\"wifi_ssid\":\"%s\",\"wifi_enc\":\"%s\","
		 "\"wifi_ap_state\":\"%s\",\"wifi_qr\":\"%s\"}",
		 ssid_j, enc_j, state_j, qr_j);
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
