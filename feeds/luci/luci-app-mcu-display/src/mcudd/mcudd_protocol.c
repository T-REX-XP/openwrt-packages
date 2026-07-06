/*
 * mcudd_protocol — RDCP v1 + legacy JSON parsing and response formatting.
 */

#include "mcudd_protocol.h"

#include "mcudd_metrics.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int json_find_string(const char *json, const char *key, char *out, size_t len)
{
	char pattern[64];
	const char *p, *start, *end;

	if (!json || !key || !out || !len)
		return -1;
	snprintf(pattern, sizeof(pattern), "\"%s\"", key);
	p = strstr(json, pattern);
	if (!p)
		return -1;
	p = strchr(p + strlen(pattern), '"');
	if (!p)
		return -1;
	start = p + 1;
	end = strchr(start, '"');
	if (!end)
		return -1;
	if ((size_t)(end - start) >= len)
		return -1;
	memcpy(out, start, (size_t)(end - start));
	out[end - start] = '\0';
	return 0;
}

static mcudd_scope_t scope_from_name(const char *name)
{
	if (!name)
		return MCUDD_SCOPE_NONE;
	if (!strcmp(name, "cpu") || !strcmp(name, "system"))
		return MCUDD_SCOPE_SYSTEM;
	if (!strcmp(name, "network"))
		return MCUDD_SCOPE_NETWORK;
	if (!strcmp(name, "storage"))
		return MCUDD_SCOPE_STORAGE;
	if (!strcmp(name, "alarms"))
		return MCUDD_SCOPE_ALARMS;
	if (!strcmp(name, "clients"))
		return MCUDD_SCOPE_CLIENTS;
	if (!strcmp(name, "wifi"))
		return MCUDD_SCOPE_WIFI;
	if (!strcmp(name, "security"))
		return MCUDD_SCOPE_SECURITY;
	return MCUDD_SCOPE_NONE;
}

const char *mcudd_scope_name(mcudd_scope_t scope)
{
	switch (scope) {
	case MCUDD_SCOPE_SYSTEM:
		return "system";
	case MCUDD_SCOPE_NETWORK:
		return "network";
	case MCUDD_SCOPE_STORAGE:
		return "storage";
	case MCUDD_SCOPE_ALARMS:
		return "alarms";
	case MCUDD_SCOPE_CLIENTS:
		return "clients";
	case MCUDD_SCOPE_WIFI:
		return "wifi";
	case MCUDD_SCOPE_SECURITY:
		return "security";
	default:
		return "";
	}
}

int mcudd_protocol_parse(const char *line, struct mcudd_parsed_msg *out)
{
	char req[32], op[32], scope[32], screen[48];
	const char *p;

	if (!line || !out)
		return -1;
	memset(out, 0, sizeof(*out));

	if (strstr(line, "\"request\"")) {
		if (json_find_string(line, "request", req, sizeof(req)) != 0)
			return -1;
		out->type = MCUDD_MSG_LEGACY_REQUEST;
		out->scope = scope_from_name(req);
		return out->scope != MCUDD_SCOPE_NONE ? 0 : -1;
	}

	if (strstr(line, "\"v\"") && strstr(line, "\"t\"")) {
		char t[16];

		if (json_find_string(line, "t", t, sizeof(t)) != 0)
			return -1;
		if (!strcmp(t, "req")) {
			out->type = MCUDD_MSG_RDCP_REQ;
			if (json_find_string(line, "op", op, sizeof(op)) == 0 &&
			    !strcmp(op, "metrics") &&
			    json_find_string(line, "scope", scope, sizeof(scope)) == 0) {
				out->scope = scope_from_name(scope);
				p = strstr(line, "\"id\":");
				if (p)
					out->req_id = (unsigned)strtoul(p + 5, NULL, 10);
				return out->scope != MCUDD_SCOPE_NONE ? 0 : -1;
			}
		}
		if (!strcmp(t, "evt")) {
			if (json_find_string(line, "op", op, sizeof(op)) != 0)
				return -1;
			if (!strcmp(op, "screen") &&
			    json_find_string(line, "screen", screen, sizeof(screen)) == 0) {
				out->type = MCUDD_MSG_RDCP_EVT;
				strncpy(out->screen, screen, sizeof(out->screen) - 1);
				return 0;
			}
			if (!strcmp(op, "input") && strstr(line, "\"gesture\"")) {
				out->type = MCUDD_MSG_RDCP_EVT_INPUT;
				if (strstr(line, "\"dir\":\"right\""))
					strncpy(out->gesture_dir, "right",
						sizeof(out->gesture_dir) - 1);
				else
					strncpy(out->gesture_dir, "left",
						sizeof(out->gesture_dir) - 1);
				return 0;
			}
		}
	}

	return -1;
}

int mcudd_protocol_build_scope(const struct mcudd_config *cfg, mcudd_scope_t scope,
			       char *buf, size_t len)
{
	if (!cfg || !buf || !len)
		return -1;

	switch (scope) {
	case MCUDD_SCOPE_SYSTEM:
		return mcudd_metrics_system(cfg, buf, len);
	case MCUDD_SCOPE_STORAGE:
		return mcudd_metrics_storage(cfg, buf, len);
	case MCUDD_SCOPE_ALARMS:
		return mcudd_metrics_alarms(cfg, buf, len);
	case MCUDD_SCOPE_NETWORK:
		return mcudd_metrics_network(cfg, buf, len);
	case MCUDD_SCOPE_CLIENTS:
		return mcudd_metrics_clients(cfg, buf, len);
	case MCUDD_SCOPE_WIFI:
		return mcudd_metrics_wifi(cfg, buf, len);
	case MCUDD_SCOPE_SECURITY:
		return mcudd_metrics_security(cfg, buf, len);
	default:
		snprintf(buf, len, "{\"error\":\"scope_unavailable\"}");
		return 0;
	}
}

int mcudd_protocol_format_out(const struct mcudd_config *cfg,
			      const struct mcudd_parsed_msg *in,
			      const char *payload, char *out, size_t out_len)
{
	if (!cfg || !in || !payload || !out || !out_len)
		return -1;

	if (!strcmp(cfg->wire_format, MCUDD_WIRE_MSGPACK))
		return -1;

	if (in->type == MCUDD_MSG_RDCP_REQ && in->req_id > 0) {
		int n = snprintf(out, out_len,
				 "{\"v\":1,\"t\":\"res\",\"id\":%u,\"data\":%s}",
				 in->req_id, payload);
		return (n > 0 && (size_t)n < out_len) ? 0 : -1;
	}

	strncpy(out, payload, out_len - 1);
	out[out_len - 1] = '\0';
	return 0;
}

mcudd_scope_t mcudd_scope_from_screen(const char *screen_id)
{
	if (!screen_id)
		return MCUDD_SCOPE_SYSTEM;
	if (!strcmp(screen_id, "router_network"))
		return MCUDD_SCOPE_NETWORK;
	if (!strcmp(screen_id, "router_clients"))
		return MCUDD_SCOPE_CLIENTS;
	if (!strcmp(screen_id, "router_storage"))
		return MCUDD_SCOPE_STORAGE;
	if (!strcmp(screen_id, "router_wifi"))
		return MCUDD_SCOPE_WIFI;
	if (!strcmp(screen_id, "router_security"))
		return MCUDD_SCOPE_SECURITY;
	return MCUDD_SCOPE_SYSTEM;
}

int mcudd_protocol_build_cmd_screen(const char *screen_id, char *out, size_t out_len)
{
	int n;

	if (!screen_id || !out || !out_len)
		return -1;
	n = snprintf(out, out_len,
		     "{\"v\":1,\"t\":\"cmd\",\"op\":\"screen\",\"data\":{\"screen\":\"%s\"}}",
		     screen_id);
	return (n > 0 && (size_t)n < out_len) ? 0 : -1;
}

int mcudd_protocol_build_push_boot(const char *stage, const char *text, unsigned pct,
				   char *out, size_t out_len)
{
	int n;

	if (!stage || !text || !out || !out_len)
		return -1;
	if (pct > 100)
		pct = 100;
	n = snprintf(out, out_len,
		     "{\"v\":1,\"t\":\"push\",\"op\":\"boot\",\"data\":{\"stage\":\"%s\",\"text\":\"%s\",\"pct\":%u}}",
		     stage, text, pct);
	return (n > 0 && (size_t)n < out_len) ? 0 : -1;
}

int mcudd_protocol_build_push_config(const struct mcudd_config *cfg,
				     char *out, size_t out_len)
{
	int n;
	const char *mode;

	if (!cfg || !out || !out_len)
		return -1;

	mode = cfg->screen_timeout_mode[0] ? cfg->screen_timeout_mode : "off";
	n = snprintf(out, out_len,
		     "{\"v\":1,\"t\":\"push\",\"op\":\"config\",\"data\":{\"screen_timeout\":%u,\"screen_timeout_mode\":\"%s\"}}",
		     cfg->screen_timeout, mode);
	return (n > 0 && (size_t)n < out_len) ? 0 : -1;
}
