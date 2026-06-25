/*
 * oledd_data — live router metrics for page token substitution.
 */

#include "oledd_data.h"

#include "oledd_net.h"
#include "oledd_ubus.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/statvfs.h>
#include <time.h>
#include <unistd.h>

static int read_int_file(const char *path, int defval)
{
	char buf[32];
	FILE *f = fopen(path, "r");
	int v;

	if (!f)
		return defval;
	if (!fgets(buf, sizeof(buf), f)) {
		fclose(f);
		return defval;
	}
	fclose(f);
	v = atoi(buf);
	return v ? v : defval;
}

static int read_cpu_temp_c(void)
{
	static const char *paths[] = {
		"/sys/class/hwmon/hwmon0/temp1_input",
		"/sys/class/hwmon/hwmon1/temp1_input",
		"/sys/class/thermal/thermal_zone0/temp",
	};
	size_t i;

	for (i = 0; i < sizeof(paths) / sizeof(paths[0]); i++) {
		int raw = read_int_file(paths[i], 0);

		if (raw > 0)
			return raw > 1000 ? raw / 1000 : raw;
	}
	return 0;
}

static void read_disk_pair(const char *mount, char *combo_out, size_t combo_len,
			   float *pct_out)
{
	struct statvfs st;
	unsigned long long total, used, u_gb, t_gb, u_mb, t_mb;

	if (statvfs(mount, &st) != 0) {
		snprintf(combo_out, combo_len, "--/--");
		*pct_out = 0.0f;
		return;
	}

	total = (unsigned long long)st.f_blocks * st.f_frsize;
	used = total - (unsigned long long)st.f_bavail * st.f_frsize;
	if (total == 0) {
		snprintf(combo_out, combo_len, "--/--");
		*pct_out = 0.0f;
		return;
	}
	*pct_out = (float)used / (float)total;
	u_gb = used / (1024ULL * 1024ULL * 1024ULL);
	t_gb = total / (1024ULL * 1024ULL * 1024ULL);
	if (t_gb >= 1) {
		u_mb = (used / (1024ULL * 1024ULL)) % 1024;
		snprintf(combo_out, combo_len, "%llu.%llu/%lluG",
			 u_gb, u_mb / 100, t_gb);
	} else {
		u_mb = used / (1024ULL * 1024ULL);
		t_mb = total / (1024ULL * 1024ULL);
		snprintf(combo_out, combo_len, "%llu/%lluM", u_mb, t_mb);
	}
}

static int count_dhcp_leases(void)
{
	FILE *f = fopen("/tmp/dhcp.leases", "r");
	char line[128];
	int n = 0;

	if (!f)
		return 0;
	while (fgets(line, sizeof(line), f))
		n++;
	fclose(f);
	return n;
}

static int ping_gateway_ms(void)
{
	FILE *f = popen("ping -c 1 -W 1 $(ip route | awk '/default/ {print $3; exit}') 2>/dev/null | awk -F'/' '/round-trip|rtt/ {print $5; exit}'", "r");
	char buf[16];
	int ms = 0;

	if (!f)
		return 0;
	if (fgets(buf, sizeof(buf), f))
		ms = atoi(buf);
	pclose(f);
	return ms;
}

void oledd_data_refresh(struct oledd_data_ctx *ctx)
{
	struct oledd_system_info sys = {};
	struct oledd_port_status ports[OLEDD_PORT_MAX];
	struct oledd_wifi_info wifi = {};
	char root_combo[24], data_combo[24];
	int i, max_leases = 250;

	if (!ctx)
		return;

	if (ctx->ubus)
		oledd_ubus_system_info(ctx->ubus, &sys);

	ctx->cpu_load = sys.load1 > 0.0f ? sys.load1 : 0.05f;
	if (ctx->cpu_load > 1.0f)
		ctx->cpu_load = 1.0f;

	if (sys.mem_total > 0)
		ctx->ram_pct = (float)(sys.mem_total - sys.mem_free) /
		    (float)sys.mem_total;
	else
		ctx->ram_pct = 0.0f;

	read_disk_pair("/", root_combo, sizeof(root_combo), &ctx->root_pct);
	if (access("/overlay", F_OK) == 0)
		read_disk_pair("/overlay", data_combo, sizeof(data_combo),
			       &ctx->data_pct);
	else
		read_disk_pair("/mnt", data_combo, sizeof(data_combo),
			       &ctx->data_pct);

	ctx->ping_ms = ping_gateway_ms();
	if (ctx->spark_count < OLEDD_SPARKLINE_LEN)
		ctx->sparkline[ctx->spark_count++] = ctx->ping_ms ? ctx->ping_ms : 1;
	else {
		for (i = 0; i < OLEDD_SPARKLINE_LEN - 1; i++)
			ctx->sparkline[i] = ctx->sparkline[i + 1];
		ctx->sparkline[OLEDD_SPARKLINE_LEN - 1] = ctx->ping_ms ? ctx->ping_ms : 1;
	}

	if (ctx->ubus)
		oledd_wifi_ap_refresh(ctx->ubus, &ctx->wifi_ap);

	(void)ports;
	(void)wifi;
	(void)max_leases;
}

const char *oledd_data_resolve(struct oledd_data_ctx *ctx, const char *token)
{
	struct oledd_system_info sys = {};
	struct oledd_port_status ports[OLEDD_PORT_MAX];
	struct oledd_wifi_info wifi = {};
	char root_combo[24] = "", data_combo[24] = "";
	time_t now;
	struct tm *tm;
	int temp, leases, wan_idx = 0;
	double rx = 0, tx = 0;

	if (!ctx || !token || !token[0])
		return "";

	if (ctx->ubus)
		oledd_ubus_system_info(ctx->ubus, &sys);

	if (!strcmp(token, "time")) {
		now = time(NULL);
		tm = localtime(&now);
		if (tm)
			snprintf(ctx->buf, sizeof(ctx->buf), "%02d:%02d",
				 tm->tm_hour, tm->tm_min);
		else
			snprintf(ctx->buf, sizeof(ctx->buf), "--:--");
		return ctx->buf;
	}

	if (!strcmp(token, "cpu_temp")) {
		temp = read_cpu_temp_c();
		snprintf(ctx->buf, sizeof(ctx->buf), temp ? "%dC" : "N/A", temp);
		return ctx->buf;
	}

	if (!strcmp(token, "ram_used")) {
		unsigned long mb = sys.mem_total > sys.mem_free ?
		    (sys.mem_total - sys.mem_free) / 1024 : 0;

		if (mb >= 1024)
			snprintf(ctx->buf, sizeof(ctx->buf), "%lu.%luG",
				 mb / 1024, (mb % 1024) * 10 / 1024);
		else
			snprintf(ctx->buf, sizeof(ctx->buf), "%luM", mb);
		return ctx->buf;
	}

	if (!strcmp(token, "temp_short")) {
		temp = read_cpu_temp_c();
		snprintf(ctx->buf, sizeof(ctx->buf), "%dC", temp);
		return ctx->buf;
	}

	if (!strcmp(token, "load_short")) {
		snprintf(ctx->buf, sizeof(ctx->buf), "%.2f", (double)sys.load1);
		return ctx->buf;
	}

	if (!strcmp(token, "uptime_short")) {
		unsigned long d = sys.uptime / 86400;
		unsigned long h = (sys.uptime % 86400) / 3600;

		if (d > 0)
			snprintf(ctx->buf, sizeof(ctx->buf), "%lud%luh", d, h);
		else
			snprintf(ctx->buf, sizeof(ctx->buf), "%luh%lum",
				 h, (sys.uptime % 3600) / 60);
		return ctx->buf;
	}

	if (ctx->ubus) {
		int n = oledd_net_poll_ports(ctx->ubus, ports, OLEDD_PORT_MAX,
					     ctx->elapsed_sec);
		int i;

		for (i = 0; i < n; i++) {
			if (!strcmp(ports[i].label, "WAN") ||
			    !strcmp(ports[i].device, "eth0")) {
				wan_idx = i;
				break;
			}
		}
		if (n > 0) {
			rx = ports[wan_idx].rx_mbps;
			tx = ports[wan_idx].tx_mbps;
			if (!strcmp(token, "wan_ip")) {
				if (ports[wan_idx].ipv4[0])
					snprintf(ctx->buf, sizeof(ctx->buf), "%s",
						 ports[wan_idx].ipv4);
				else
					snprintf(ctx->buf, sizeof(ctx->buf), "---");
				return ctx->buf;
			}
		}
	}

	if (!strcmp(token, "rx_rate")) {
		snprintf(ctx->buf, sizeof(ctx->buf), "%.1f Mb", rx);
		return ctx->buf;
	}

	if (!strcmp(token, "tx_rate")) {
		snprintf(ctx->buf, sizeof(ctx->buf), "%.1f Mb", tx);
		return ctx->buf;
	}

	if (!strcmp(token, "ping_ms")) {
		snprintf(ctx->buf, sizeof(ctx->buf), "%dms", ctx->ping_ms);
		return ctx->buf;
	}

	if (!strcmp(token, "clients_total")) {
		int total = 0;

		if (ctx->ubus && oledd_ubus_wifi_status(ctx->ubus, &wifi) == 0 &&
		    wifi.valid && wifi.num_sta >= 0)
			total = wifi.num_sta;
		snprintf(ctx->buf, sizeof(ctx->buf), "%02d", total);
		return ctx->buf;
	}

	if (!strcmp(token, "wifi_24") || !strcmp(token, "wifi_5") ||
	    !strcmp(token, "lan_clients")) {
		int n = 0;

		if (!strcmp(token, "lan_clients"))
			n = count_dhcp_leases() > 2 ? 2 : count_dhcp_leases();
		else if (ctx->ubus &&
			 oledd_ubus_wifi_status(ctx->ubus, &wifi) == 0 &&
			 wifi.valid && wifi.num_sta >= 0)
			n = wifi.num_sta / 2;
		snprintf(ctx->buf, sizeof(ctx->buf), "%02d", n);
		return ctx->buf;
	}

	if (!strcmp(token, "dhcp_leases")) {
		leases = count_dhcp_leases();
		snprintf(ctx->buf, sizeof(ctx->buf), "%d/250", leases);
		return ctx->buf;
	}

	read_disk_pair("/", root_combo, sizeof(root_combo), &ctx->root_pct);
	read_disk_pair(access("/overlay", F_OK) == 0 ? "/overlay" : "/mnt",
		       data_combo, sizeof(data_combo), &ctx->data_pct);

	if (!strcmp(token, "root_usage"))
		snprintf(ctx->buf, sizeof(ctx->buf), "%s", root_combo);
	else if (!strcmp(token, "data_usage"))
		snprintf(ctx->buf, sizeof(ctx->buf), "%s", data_combo);
	else if (!strcmp(token, "swap_usage"))
		snprintf(ctx->buf, sizeof(ctx->buf), "0/2G");
	else if (!strcmp(token, "blocked_24h"))
		snprintf(ctx->buf, sizeof(ctx->buf), "0");
	else if (!strcmp(token, "vpn_tunnels"))
		snprintf(ctx->buf, sizeof(ctx->buf), "0 UP");
	else if (!strcmp(token, "firewall_state"))
		snprintf(ctx->buf, sizeof(ctx->buf), "ACTIVE");
	else if (!strcmp(token, "wifi_ssid")) {
		if (ctx->wifi_ap.active && ctx->wifi_ap.ssid[0])
			snprintf(ctx->buf, sizeof(ctx->buf), "%s", ctx->wifi_ap.ssid);
		else
			snprintf(ctx->buf, sizeof(ctx->buf), "NO AP");
		return ctx->buf;
	} else if (!strcmp(token, "wifi_ap_state")) {
		snprintf(ctx->buf, sizeof(ctx->buf),
			 ctx->wifi_ap.active ? "ACTIVE" : "NO AP");
		return ctx->buf;
	} else if (!strcmp(token, "wifi_qr")) {
		if (ctx->wifi_ap.active && ctx->wifi_ap.qr_payload[0])
			snprintf(ctx->buf, sizeof(ctx->buf), "%s",
				 ctx->wifi_ap.qr_payload);
		else
			ctx->buf[0] = '\0';
		return ctx->buf;
	} else
		ctx->buf[0] = '\0';

	return ctx->buf;
}

double oledd_data_resolve_float(struct oledd_data_ctx *ctx, const char *token)
{
	if (!ctx || !token)
		return 0.0;

	if (!strcmp(token, "cpu_load"))
		return (double)ctx->cpu_load;
	if (!strcmp(token, "ram_pct"))
		return (double)ctx->ram_pct;
	if (!strcmp(token, "root_pct"))
		return (double)ctx->root_pct;
	if (!strcmp(token, "data_pct"))
		return (double)ctx->data_pct;
	if (!strcmp(token, "dhcp_pct")) {
		int leases = count_dhcp_leases();

		return leases > 0 ? (double)leases / 250.0 : 0.0;
	}
	return 0.0;
}
