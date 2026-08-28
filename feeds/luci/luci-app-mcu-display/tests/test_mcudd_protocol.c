/*
 * Unit tests for mcudd_protocol (host build).
 */

#include <stdio.h>
#include <string.h>

#include "mcudd_config.h"
#include "mcudd_protocol.h"

static int tests_run;
static int tests_failed;

static void expect(int cond, const char *msg)
{
	tests_run++;
	if (!cond) {
		tests_failed++;
		printf("FAIL: %s\n", msg);
	}
}

static struct mcudd_config test_cfg(void)
{
	struct mcudd_config cfg;

	memset(&cfg, 0, sizeof(cfg));
	cfg.demo_mode = 0;
	cfg.screen_timeout = 60;
	strncpy(cfg.screen_timeout_mode, "off", sizeof(cfg.screen_timeout_mode) - 1);
	strncpy(cfg.wire_format, MCUDD_WIRE_JSON, sizeof(cfg.wire_format) - 1);
	return cfg;
}

static void test_legacy_cpu_request(void)
{
	struct mcudd_parsed_msg msg;
	char payload[512];
	char out[1024];
	struct mcudd_config cfg = test_cfg();

	expect(mcudd_protocol_parse("{\"request\":\"cpu\"}", &msg) == 0,
	       "parse legacy cpu");
	expect(msg.type == MCUDD_MSG_LEGACY_REQUEST, "legacy type");
	expect(msg.scope == MCUDD_SCOPE_SYSTEM, "cpu maps to system");

	expect(mcudd_protocol_build_scope(&cfg, msg.scope, payload, sizeof(payload)) == 0,
	       "build system scope");
	expect(strstr(payload, "\"cpu\"") != NULL, "payload has cpu");

	expect(mcudd_protocol_format_out(&cfg, &msg, payload, out, sizeof(out)) == 0,
	       "format legacy out");
	expect(out[0] == '{', "legacy flat json");
	expect(strstr(out, "\"t\":\"res\"") == NULL, "no rdcp wrapper");
}

static void test_rdcp_req(void)
{
	struct mcudd_parsed_msg msg;
	char payload[512];
	char out[1024];
	struct mcudd_config cfg = test_cfg();
	const char *line =
		"{\"v\":1,\"t\":\"req\",\"id\":7,\"op\":\"metrics\",\"scope\":\"storage\"}";

	expect(mcudd_protocol_parse(line, &msg) == 0, "parse rdcp req");
	expect(msg.req_id == 7, "req id");
	expect(msg.scope == MCUDD_SCOPE_STORAGE, "storage scope");

	expect(mcudd_protocol_build_scope(&cfg, msg.scope, payload, sizeof(payload)) == 0,
	       "build storage");
	expect(mcudd_protocol_format_out(&cfg, &msg, payload, out, sizeof(out)) == 0,
	       "format rdcp res");
	expect(strstr(out, "\"id\":7") != NULL, "res id");
	expect(strstr(out, "\"t\":\"res\"") != NULL, "res type");
}

static void test_demo_alarms_config(void)
{
	struct mcudd_config cfg = test_cfg();
	char payload[256];

	cfg.demo_mode = 1;
	expect(mcudd_protocol_build_scope(&cfg, MCUDD_SCOPE_ALARMS, payload,
					  sizeof(payload)) == 0,
	       "demo alarms");
	expect(strstr(payload, "Demo") != NULL, "demo label");

	cfg.demo_mode = 0;
	expect(mcudd_protocol_build_scope(&cfg, MCUDD_SCOPE_ALARMS, payload,
					  sizeof(payload)) == 0,
	       "empty alarms");
	expect(strstr(payload, "\"alarms\":[]") != NULL, "empty array");
}

static void test_msgpack_rejected(void)
{
	struct mcudd_parsed_msg msg;
	struct mcudd_config cfg = test_cfg();
	char out[256];

	strncpy(cfg.wire_format, MCUDD_WIRE_MSGPACK, sizeof(cfg.wire_format) - 1);
	mcudd_protocol_parse("{\"request\":\"cpu\"}", &msg);
	expect(mcudd_protocol_format_out(&cfg, &msg, "{}", out, sizeof(out)) != 0,
	       "msgpack format rejected until phase 2");
}

static void test_gesture_evt(void)
{
	struct mcudd_parsed_msg msg;
	const char *line =
		"{\"v\":1,\"t\":\"evt\",\"op\":\"input\",\"data\":{\"type\":\"gesture\",\"dir\":\"left\"}}";

	expect(mcudd_protocol_parse(line, &msg) == 0, "parse gesture evt");
	expect(msg.type == MCUDD_MSG_RDCP_EVT_INPUT, "gesture type");
	expect(!strcmp(msg.gesture_dir, "left"), "gesture dir left");
}

static void test_screen_evt(void)
{
	struct mcudd_parsed_msg msg;
	const char *line =
		"{\"v\":1,\"t\":\"evt\",\"op\":\"screen\",\"data\":{\"screen\":\"router_system\",\"action\":\"loaded\"}}";

	expect(mcudd_protocol_parse(line, &msg) == 0, "parse screen evt");
	expect(msg.type == MCUDD_MSG_RDCP_EVT, "screen evt type");
	expect(!strcmp(msg.screen, "router_system"), "screen id from data object");
}

static void test_cmd_screen_builder(void)
{
	char out[256];

	expect(mcudd_protocol_build_cmd_screen("router_wifi", out, sizeof(out)) == 0,
	       "build cmd screen");
	expect(strstr(out, "router_wifi") != NULL, "cmd has screen id");
	expect(strstr(out, "\"dir\":\"left\"") != NULL, "cmd has default dir");
	expect(strstr(out, "\"t\":\"cmd\"") != NULL, "cmd type");
}

static void test_cmd_nav_builder(void)
{
	char out[256];

	expect(mcudd_protocol_build_cmd_nav("next", out, sizeof(out)) == 0, "build cmd nav next");
	expect(strstr(out, "\"op\":\"nav\"") != NULL, "nav op");
	expect(strstr(out, "\"dir\":\"next\"") != NULL, "nav dir next");
	expect(mcudd_protocol_build_cmd_nav("prev", out, sizeof(out)) == 0, "build cmd nav prev");
	expect(strstr(out, "\"dir\":\"prev\"") != NULL, "nav dir prev");
	expect(mcudd_protocol_build_cmd_nav("up", out, sizeof(out)) != 0, "reject bad nav dir");
}

static void test_rdcp_poweroff_req(void)
{
	struct mcudd_parsed_msg msg;
	const char *line =
		"{\"v\":1,\"t\":\"req\",\"op\":\"poweroff\",\"data\":{\"source\":\"sw1\"}}";

	expect(mcudd_protocol_parse(line, &msg) == 0, "parse poweroff req");
	expect(msg.type == MCUDD_MSG_RDCP_REQ_POWEROFF, "poweroff type");
}

static void test_push_config_builder(void)
{
	struct mcudd_config cfg = test_cfg();
	char out[256];

	cfg.screen_timeout = 120;
	strncpy(cfg.screen_timeout_mode, "dim", sizeof(cfg.screen_timeout_mode) - 1);
	expect(mcudd_protocol_build_push_config(&cfg, out, sizeof(out)) == 0,
	       "build push config");
	expect(strstr(out, "\"t\":\"push\"") != NULL, "push type");
	expect(strstr(out, "\"op\":\"config\"") != NULL, "config op");
	expect(strstr(out, "\"screen_timeout\":120") != NULL, "timeout value");
	expect(strstr(out, "\"screen_timeout_mode\":\"dim\"") != NULL, "timeout mode");
}

int main(void)
{
	test_legacy_cpu_request();
	test_rdcp_req();
	test_demo_alarms_config();
	test_msgpack_rejected();
	test_gesture_evt();
	test_screen_evt();
	test_cmd_screen_builder();
	test_cmd_nav_builder();
	test_rdcp_poweroff_req();
	test_push_config_builder();

	printf("Ran %d tests, %d failed\n", tests_run, tests_failed);
	return tests_failed ? 1 : 0;
}
