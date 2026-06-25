/*
 * Host unit tests for pure oledd logic (mirrors oledd_input.c / oledd_menu.c /
 * oledd_pages.c subst_tokens). No OpenWrt libs required.
 *
 * Build: cc -std=c99 -Wall -Wextra -o test_oledd_logic test_oledd_logic.c
 * Run:   ./test_oledd_logic
 */

#include <stdio.h>
#include <string.h>

/* --- mirrored from oledd_input.c parse_line --- */
typedef enum {
	OLEDD_EV_NONE = 0,
	OLEDD_EV_NET,
	OLEDD_EV_UP,
	OLEDD_EV_DOWN,
	OLEDD_EV_OK,
	OLEDD_EV_BACK,
	OLEDD_EV_NEXT,
	OLEDD_EV_REFRESH,
} oledd_event_t;

static oledd_event_t parse_line(const char *line)
{
	if (!strcmp(line, "net"))
		return OLEDD_EV_NET;
	if (!strcmp(line, "up"))
		return OLEDD_EV_UP;
	if (!strcmp(line, "down"))
		return OLEDD_EV_DOWN;
	if (!strcmp(line, "ok"))
		return OLEDD_EV_OK;
	if (!strcmp(line, "back"))
		return OLEDD_EV_BACK;
	if (!strcmp(line, "next"))
		return OLEDD_EV_NEXT;
	if (!strcmp(line, "refresh"))
		return OLEDD_EV_REFRESH;
	if (!strcmp(line, "prev"))
		return OLEDD_EV_UP;
	return OLEDD_EV_NONE;
}

/* --- mirrored boot_active logic from oledd_menu.c --- */
static int boot_active_from_stage(const char *stage)
{
	if (!stage || !stage[0])
		return 1;
	if (!strcmp(stage, "ready"))
		return 0;
	if (!strcmp(stage, "network"))
		return 0;
	return 1;
}

/* --- minimal token subst (oledd_pages.c / luci.oled.uc) --- */
static const char *lookup(const char *tok)
{
	if (!strcmp(tok, "time"))
		return "12:34";
	if (!strcmp(tok, "cpu_temp"))
		return "45C";
	if (!strcmp(tok, "wan_ip"))
		return "192.168.1.1";
	return "";
}

static void subst_tokens(char *dst, size_t len, const char *src)
{
	const char *p, *start;
	size_t out = 0;

	if (!dst || !len)
		return;
	dst[0] = '\0';
	if (!src)
		return;

	for (p = src; *p && out + 1 < len; p++) {
		if (*p != '{') {
			dst[out++] = *p;
			continue;
		}
		start = ++p;
		while (*p && *p != '}')
			p++;
		if (*p == '}') {
			char tok[32];
			size_t tl = (size_t)(p - start);

			if (tl >= sizeof(tok))
				tl = sizeof(tok) - 1;
			memcpy(tok, start, tl);
			tok[tl] = '\0';
			strncpy(dst + out, lookup(tok), len - out - 1);
			out = strlen(dst);
		}
	}
	dst[out] = '\0';
}

static int g_fail;
static int g_pass;

static void expect_int(const char *name, int got, int want)
{
	if (got == want) {
		g_pass++;
	} else {
		printf("FAIL %s: got %d want %d\n", name, got, want);
		g_fail++;
	}
}

static void expect_str(const char *name, const char *got, const char *want)
{
	if (got && want && !strcmp(got, want)) {
		g_pass++;
	} else {
		printf("FAIL %s: got '%s' want '%s'\n", name,
		       got ? got : "(null)", want ? want : "(null)");
		g_fail++;
	}
}

int main(void)
{
	char buf[128];

	printf("=== oledd logic unit tests ===\n");

	expect_int("parse next", parse_line("next"), OLEDD_EV_NEXT);
	expect_int("parse prev->up", parse_line("prev"), OLEDD_EV_UP);
	expect_int("parse net", parse_line("net"), OLEDD_EV_NET);
	expect_int("parse garbage", parse_line("bogus"), OLEDD_EV_NONE);
	expect_int("parse empty", parse_line(""), OLEDD_EV_NONE);

	expect_int("boot missing stage", boot_active_from_stage(NULL), 1);
	expect_int("boot preinit", boot_active_from_stage("preinit"), 1);
	expect_int("boot boot", boot_active_from_stage("boot"), 1);
	expect_int("boot network done", boot_active_from_stage("network"), 0);
	expect_int("boot ready done", boot_active_from_stage("ready"), 0);

	subst_tokens(buf, sizeof(buf), "WAN {wan_ip}");
	expect_str("subst wan", buf, "WAN 192.168.1.1");

	subst_tokens(buf, sizeof(buf), "{time} / {cpu_temp}");
	expect_str("subst multi", buf, "12:34 / 45C");

	subst_tokens(buf, sizeof(buf), "no tokens");
	expect_str("subst plain", buf, "no tokens");

	printf("\nResults: %d passed, %d failed\n", g_pass, g_fail);
	return g_fail ? 1 : 0;
}
