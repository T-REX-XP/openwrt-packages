/*
 * mcudd_metrics — collect host metrics without hardcoded device paths.
 */

#include "mcudd_metrics.h"

#include <stdio.h>
#include <string.h>
#include <sys/statvfs.h>

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

int mcudd_metrics_system(const struct mcudd_config *cfg, char *buf, size_t len)
{
	float load1 = 0.0f;
	unsigned long mem_total = 0, mem_avail = 0;
	unsigned ram_pct = 0;
	int cpu_pct;

	(void)cfg;

	if (!buf || !len)
		return -1;

	read_proc_loadavg(&load1);
	read_meminfo(&mem_total, &mem_avail);
	if (mem_total > 0 && mem_avail <= mem_total)
		ram_pct = (unsigned)(((mem_total - mem_avail) * 100UL) / mem_total);

	cpu_pct = (int)(load1 * 100.0f);
	if (cpu_pct > 100)
		cpu_pct = 100;
	if (cpu_pct < 0)
		cpu_pct = 0;

	snprintf(buf, len,
		 "{\"cpu\":\"%d\",\"temp_c\":\"--\",\"fs_free\":\"--\","
		 "\"ram_pct\":%u,\"load\":\"%.2f\"}",
		 cpu_pct, ram_pct, load1);
	return 0;
}

int mcudd_metrics_storage(const struct mcudd_config *cfg, char *buf, size_t len)
{
	struct statvfs st;
	unsigned long long total, free_b;

	(void)cfg;

	if (!buf || !len)
		return -1;

	if (statvfs("/", &st) != 0) {
		snprintf(buf, len, "{\"storage\":[]}");
		return 0;
	}

	total = (unsigned long long)st.f_blocks * st.f_frsize;
	free_b = (unsigned long long)st.f_bavail * st.f_frsize;

	snprintf(buf, len,
		 "{\"storage\":[{\"mountpoint\":\"/\",\"total_gb\":\"%.2f\","
		 "\"free_gb\":\"%.2f\",\"used_percent\":\"%.1f\"}]}",
		 total / (1024.0 * 1024.0 * 1024.0),
		 free_b / (1024.0 * 1024.0 * 1024.0),
		 total ? (100.0 * (total - free_b) / total) : 0.0);
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

int mcudd_metrics_network(const struct mcudd_config *cfg, char *buf, size_t len)
{
	(void)cfg;

	if (!buf || !len)
		return -1;

	snprintf(buf, len,
		 "{\"wan_ip\":\"--\",\"rx_rate\":\"--\",\"tx_rate\":\"--\","
		 "\"ping_ms\":0}");
	return 0;
}
