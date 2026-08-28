/*
 * mcudd_protocol — RDCP v1 + legacy JSON parsing and response formatting.
 */

#include "mcudd_protocol.h"

#include "mcud_version.h"
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

/* Prefer keys inside "data":{...} — avoids matching "op":"screen" values. */
static int json_find_data_string(const char *json, const char *key, char *out, size_t len)
{
	const char *data;

	if (!json || !key || !out || !len)
		return -1;
	data = strstr(json, "\"data\"");
	if (!data)
		return json_find_string(json, key, out, len);
	return json_find_string(data, key, out, len);
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

static int json_find_data_uint(const char *json, const char *key, unsigned *out)
{
	const char *data;
	char pattern[64];
	const char *p;
	char *end = NULL;
	unsigned long v;

	if (!json || !key || !out)
		return -1;

	data = strstr(json, "\"data\"");
	if (!data)
		data = json;

	snprintf(pattern, sizeof(pattern), "\"%s\":", key);
	p = strstr(data, pattern);
	if (!p)
		return -1;
	p += strlen(pattern);
	while (*p == ' ' || *p == '\t')
		p++;
	/* Quoted numeric string ("31") or bare number (31). */
	if (*p == '"') {
		p++;
		v = strtoul(p, &end, 10);
		if (!end || end == p || *end != '"')
			return -1;
	} else {
		v = strtoul(p, &end, 10);
		if (!end || end == p)
			return -1;
	}
	*out = (unsigned)v;
	return 0;
}

static int parse_version_payload(const char *line, struct mcudd_parsed_msg *out)
{
	if (json_find_data_string(line, "stack", out->version_stack,
				  sizeof(out->version_stack)) != 0)
		return -1;
	if (json_find_data_string(line, "component", out->version_component,
				  sizeof(out->version_component)) != 0)
		strncpy(out->version_component, MCUD_COMPONENT_FIRMWARE,
			sizeof(out->version_component) - 1);
	if (json_find_data_uint(line, "release", &out->version_release) != 0)
		return -1;
	if (json_find_data_uint(line, "rdcp", &out->version_rdcp) != 0)
		out->version_rdcp = 1;
	out->type = MCUDD_MSG_RDCP_EVT_VERSION;
	return 0;
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
			if (json_find_string(line, "op", op, sizeof(op)) == 0 &&
			    !strcmp(op, "version")) {
				out->type = MCUDD_MSG_RDCP_REQ;
				out->scope = MCUDD_SCOPE_NONE;
				p = strstr(line, "\"id\":");
				if (p)
					out->req_id = (unsigned)strtoul(p + 5, NULL, 10);
				return 0;
			}
			if (json_find_string(line, "op", op, sizeof(op)) == 0 &&
			    !strcmp(op, "ping")) {
				out->type = MCUDD_MSG_RDCP_REQ;
				out->scope = MCUDD_SCOPE_NONE;
				p = strstr(line, "\"id\":");
				if (p)
					out->req_id = (unsigned)strtoul(p + 5, NULL, 10);
				return 0;
			}
			if (json_find_string(line, "op", op, sizeof(op)) == 0 &&
			    !strcmp(op, "poweroff")) {
				out->type = MCUDD_MSG_RDCP_REQ_POWEROFF;
				out->scope = MCUDD_SCOPE_NONE;
				return 0;
			}
		}
		if (!strcmp(t, "res")) {
			if (strstr(line, "\"pong\"")) {
				out->type = MCUDD_MSG_RDCP_RES_PING;
				p = strstr(line, "\"id\":");
				if (p)
					out->req_id = (unsigned)strtoul(p + 5, NULL, 10);
				if (json_find_data_uint(line, "uptime_ms", &out->uptime_ms) != 0)
					out->uptime_ms = 0;
				return 0;
			}
		}
		if (!strcmp(t, "evt")) {
			if (json_find_string(line, "op", op, sizeof(op)) != 0)
				return -1;
			if (!strcmp(op, "screen") &&
			    json_find_data_string(line, "screen", screen, sizeof(screen)) == 0) {
				out->type = MCUDD_MSG_RDCP_EVT;
				strncpy(out->screen, screen, sizeof(out->screen) - 1);
				return 0;
			}
			if (!strcmp(op, "version"))
				return parse_version_payload(line, out);
			if (!strcmp(op, "echo")) {
				out->type = MCUDD_MSG_RDCP_EVT_ECHO;
				if (json_find_data_string(line, "text", out->echo_text,
							  sizeof(out->echo_text)) != 0)
					out->echo_text[0] = '\0';
				return 0;
			}
			if (!strcmp(op, "input") && strstr(line, "\"gesture\"")) {
				out->type = MCUDD_MSG_RDCP_EVT_INPUT;
				if (json_find_data_string(line, "dir", out->gesture_dir,
							  sizeof(out->gesture_dir)) != 0) {
					if (strstr(line, "\"dir\":\"right\""))
						strncpy(out->gesture_dir, "right",
							sizeof(out->gesture_dir) - 1);
					else
						strncpy(out->gesture_dir, "left",
							sizeof(out->gesture_dir) - 1);
				}
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
	return mcudd_protocol_build_cmd_screen_dir(screen_id, NULL, out, out_len);
}

int mcudd_protocol_build_cmd_screen_dir(const char *screen_id, const char *dir,
					char *out, size_t out_len)
{
	int n;
	const char *anim_dir = dir && dir[0] ? dir : "left";

	if (!screen_id || !out || !out_len)
		return -1;
	n = snprintf(out, out_len,
		     "{\"v\":1,\"t\":\"cmd\",\"op\":\"screen\",\"data\":{\"screen\":\"%s\",\"dir\":\"%s\"}}",
		     screen_id, anim_dir);
	return (n > 0 && (size_t)n < out_len) ? 0 : -1;
}

int mcudd_protocol_build_cmd_nav(const char *dir, char *out, size_t out_len)
{
	int n;
	const char *nav_dir = dir && dir[0] ? dir : "next";

	if (!out || !out_len)
		return -1;
	if (strcmp(nav_dir, "prev") && strcmp(nav_dir, "next"))
		return -1;
	n = snprintf(out, out_len,
		     "{\"v\":1,\"t\":\"cmd\",\"op\":\"nav\",\"data\":{\"dir\":\"%s\"}}",
		     nav_dir);
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

int mcudd_protocol_build_push_hello(char *out, size_t out_len)
{
	int n;

	if (!out || !out_len)
		return -1;
	n = snprintf(out, out_len,
		     "{\"v\":1,\"t\":\"push\",\"op\":\"hello\",\"data\":{\"stack\":\"%s\",\"release\":%u,\"component\":\"%s\",\"rdcp\":%u}}",
		     MCUD_STACK_VERSION, MCUD_STACK_RELEASE, MCUD_COMPONENT_HOST,
		     MCUD_RDCP_VERSION);
	return (n > 0 && (size_t)n < out_len) ? 0 : -1;
}

int mcudd_protocol_build_req_version(unsigned req_id, char *out, size_t out_len)
{
	int n;

	if (!out || !out_len || !req_id)
		return -1;
	n = snprintf(out, out_len,
		     "{\"v\":1,\"t\":\"req\",\"id\":%u,\"op\":\"version\"}",
		     req_id);
	return (n > 0 && (size_t)n < out_len) ? 0 : -1;
}

static int json_escape_text(const char *in, char *out, size_t out_len)
{
	size_t i, j;

	if (!in || !out || out_len < 2)
		return -1;
	for (i = 0, j = 0; in[i] && j + 2 < out_len; i++) {
		char c = in[i];

		if (c == '"' || c == '\\') {
			out[j++] = '\\';
			out[j++] = c;
		} else if (c >= 0x20 && c < 0x7f) {
			out[j++] = c;
		}
	}
	out[j] = '\0';
	return 0;
}

int mcudd_protocol_build_req_ping(unsigned req_id, char *out, size_t out_len)
{
	int n;

	if (!out || !out_len || !req_id)
		return -1;
	n = snprintf(out, out_len,
		     "{\"v\":1,\"t\":\"req\",\"id\":%u,\"op\":\"ping\"}",
		     req_id);
	return (n > 0 && (size_t)n < out_len) ? 0 : -1;
}

int mcudd_protocol_build_cmd_echo(const char *text, char *out, size_t out_len)
{
	char escaped[128];
	int n;

	if (!text || !out || !out_len)
		return -1;
	if (json_escape_text(text, escaped, sizeof(escaped)) != 0)
		return -1;
	n = snprintf(out, out_len,
		     "{\"v\":1,\"t\":\"cmd\",\"op\":\"echo\",\"data\":{\"text\":\"%s\"}}",
		     escaped);
	return (n > 0 && (size_t)n < out_len) ? 0 : -1;
}
