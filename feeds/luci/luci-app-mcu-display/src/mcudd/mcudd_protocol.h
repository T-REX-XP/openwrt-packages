/*
 * mcudd_protocol — RDCP v1 + legacy JSON line protocol (parse/build only).
 */

#ifndef MCUDD_PROTOCOL_H
#define MCUDD_PROTOCOL_H

#include <stddef.h>

#include "mcudd_config.h"

typedef enum {
	MCUDD_MSG_NONE = 0,
	MCUDD_MSG_LEGACY_REQUEST,
	MCUDD_MSG_RDCP_REQ,
	MCUDD_MSG_RDCP_EVT,
	MCUDD_MSG_RDCP_EVT_INPUT,
	MCUDD_MSG_RDCP_ERR,
} mcudd_msg_type_t;

typedef enum {
	MCUDD_SCOPE_NONE = 0,
	MCUDD_SCOPE_SYSTEM,
	MCUDD_SCOPE_NETWORK,
	MCUDD_SCOPE_STORAGE,
	MCUDD_SCOPE_ALARMS,
	MCUDD_SCOPE_CLIENTS,
	MCUDD_SCOPE_WIFI,
	MCUDD_SCOPE_SECURITY,
} mcudd_scope_t;

struct mcudd_parsed_msg {
	mcudd_msg_type_t type;
	mcudd_scope_t scope;
	unsigned req_id;
	char screen[48];
	char gesture_dir[8];
};

/* Parse one inbound newline-stripped line. Returns 0 on recognized message. */
int mcudd_protocol_parse(const char *line, struct mcudd_parsed_msg *out);

/* Build outbound payload for a scope into buf (JSON object body or legacy flat). */
int mcudd_protocol_build_scope(const struct mcudd_config *cfg, mcudd_scope_t scope,
			       char *buf, size_t len);

/* Wrap payload as RDCP res frame when id > 0, else legacy flat JSON line. */
int mcudd_protocol_format_out(const struct mcudd_config *cfg,
			      const struct mcudd_parsed_msg *in,
			      const char *payload, char *out, size_t out_len);

const char *mcudd_scope_name(mcudd_scope_t scope);

mcudd_scope_t mcudd_scope_from_screen(const char *screen_id);

/* Host → MCU command / push builders (newline not included). */
int mcudd_protocol_build_cmd_screen(const char *screen_id, char *out, size_t out_len);
int mcudd_protocol_build_push_boot(const char *stage, const char *text, unsigned pct,
				   char *out, size_t out_len);

#endif /* MCUDD_PROTOCOL_H */
