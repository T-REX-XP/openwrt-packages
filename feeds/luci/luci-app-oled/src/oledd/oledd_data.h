/*
 * oledd_data — live router metrics for page token substitution.
 */

#ifndef OLEDD_DATA_H
#define OLEDD_DATA_H

struct ubus_context;

#define OLEDD_SPARKLINE_LEN 16

struct oledd_data_ctx {
	struct ubus_context *ubus;
	double elapsed_sec;
	char buf[48];
	float cpu_load;
	float ram_pct;
	float root_pct;
	float data_pct;
	float dhcp_pct;
	int ping_ms;
	int sparkline[OLEDD_SPARKLINE_LEN];
	int spark_count;
};

void oledd_data_refresh(struct oledd_data_ctx *ctx);
const char *oledd_data_resolve(struct oledd_data_ctx *ctx, const char *token);
double oledd_data_resolve_float(struct oledd_data_ctx *ctx, const char *token);

#endif /* OLEDD_DATA_H */
