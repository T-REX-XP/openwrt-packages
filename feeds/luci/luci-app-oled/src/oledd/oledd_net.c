/*
 * oledd_net — sysfs bandwidth and port aggregation (Phase 2).
 */

#include "oledd_net.h"

#include "oledd_ubus.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct bw_state {
	uint64_t rx;
	uint64_t tx;
	int have_sample;
};

static struct oledd_port_entry g_ports[OLEDD_PORT_MAX];
static int g_port_count;
static struct bw_state g_bw[OLEDD_PORT_MAX];

static uint64_t read_counter(const char *device, const char *name)
{
	char path[96];
	char buf[32];
	FILE *f;
	uint64_t val = 0;

	snprintf(path, sizeof(path),
		 "/sys/class/net/%s/statistics/%s_bytes", device, name);
	f = fopen(path, "r");
	if (!f)
		return 0;
	if (fscanf(f, "%31s", buf) == 1)
		val = strtoull(buf, NULL, 10);
	fclose(f);
	return val;
}

void oledd_net_ports_init(const struct oledd_port_entry *ports, int count)
{
	int i;

	g_port_count = count;
	if (count > OLEDD_PORT_MAX)
		g_port_count = OLEDD_PORT_MAX;

	for (i = 0; i < g_port_count; i++)
		g_ports[i] = ports[i];

	memset(g_bw, 0, sizeof(g_bw));
}

static double rate_mbps(uint64_t now, uint64_t prev, double elapsed)
{
	uint64_t delta;

	if (elapsed <= 0.0 || now < prev)
		return 0.0;

	delta = now - prev;
	return (double)delta * 8.0 / elapsed / 1000000.0;
}

int oledd_net_poll_ports(struct ubus_context *ctx,
			 struct oledd_port_status *out, int max,
			 double elapsed_sec)
{
	int i, n = g_port_count;

	if (!out || max <= 0)
		return 0;
	if (n > max)
		n = max;

	for (i = 0; i < n; i++) {
		struct oledd_dev_status dev = {};
		uint64_t rx, tx;
		struct oledd_port_status *ps = &out[i];

		memset(ps, 0, sizeof(*ps));
		strncpy(ps->device, g_ports[i].device, sizeof(ps->device) - 1);

		if (ctx &&
		    oledd_ubus_device_status(ctx, g_ports[i].device, &dev) == 0) {
			ps->up = dev.up;
			ps->carrier = dev.carrier;
		}

		if (g_ports[i].iface && ctx)
			oledd_ubus_interface_ipv4(ctx, g_ports[i].iface,
						    ps->ipv4, sizeof(ps->ipv4));

		rx = read_counter(g_ports[i].device, "rx");
		tx = read_counter(g_ports[i].device, "tx");

		if (g_bw[i].have_sample && elapsed_sec > 0.0) {
			ps->rx_mbps = rate_mbps(rx, g_bw[i].rx, elapsed_sec);
			ps->tx_mbps = rate_mbps(tx, g_bw[i].tx, elapsed_sec);
		}

		g_bw[i].rx = rx;
		g_bw[i].tx = tx;
		g_bw[i].have_sample = 1;
	}

	return n;
}
