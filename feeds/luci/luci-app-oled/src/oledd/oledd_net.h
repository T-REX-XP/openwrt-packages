/*
 * oledd_net — sysfs bandwidth and port aggregation (Phase 2).
 */

#ifndef OLEDD_NET_H
#define OLEDD_NET_H

#include <stddef.h>

struct ubus_context;

#define OLEDD_PORT_MAX 3
#define OLEDD_BAR_MAX_MBPS 1000.0

struct oledd_port_entry {
	const char *device;
	const char *iface; /* network.interface name for IPv4, or NULL */
};

struct oledd_port_status {
	char device[16];
	int up;
	int carrier;
	char ipv4[16];
	double rx_mbps;
	double tx_mbps;
};

void oledd_net_ports_init(const struct oledd_port_entry *ports, int count);

int oledd_net_poll_ports(struct ubus_context *ctx,
			 struct oledd_port_status *out, int max,
			 double elapsed_sec);

#endif /* OLEDD_NET_H */
