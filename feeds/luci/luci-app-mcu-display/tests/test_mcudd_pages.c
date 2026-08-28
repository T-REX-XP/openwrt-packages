/*
 * Unit tests for mcudd_pages (host build).
 */

#include <stdio.h>
#include <string.h>

#include "mcudd_pages.h"

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

static void test_page_index(void)
{
	expect(mcudd_page_index("router_system") == 0, "system idx 0");
	expect(mcudd_page_index("router_security") == 5, "security idx 5");
	expect(mcudd_page_index("router_boot") < 0, "boot not in page list");
	expect(mcudd_page_index("data") < 0, "unknown screen");
	expect(mcudd_page_index(NULL) < 0, "null screen");
	expect(mcudd_page_index("") < 0, "empty screen");
}

static void test_screen_id_known(void)
{
	expect(mcudd_screen_id_known("router_wifi") == 1, "wifi known");
	expect(mcudd_screen_id_known("router_boot") == 1, "boot known");
	expect(mcudd_screen_id_known("garbage") == 0, "garbage unknown");
	expect(mcudd_screen_id_known(NULL) == 0, "null unknown");
}

static void test_page_neighbor(void)
{
	expect(!strcmp(mcudd_page_neighbor("router_system", "left"), "router_network"),
	       "next from system");
	expect(!strcmp(mcudd_page_neighbor("router_security", "left"), "router_system"),
	       "wrap next from security");
	expect(!strcmp(mcudd_page_neighbor("router_system", "right"), "router_security"),
	       "prev from system wraps");
	expect(!strcmp(mcudd_page_neighbor("router_boot", "left"), "router_system"),
	       "boot -> system");
	expect(!strcmp(mcudd_page_neighbor("data", "left"), "router_network"),
	       "unknown -> system then next");
}

int main(void)
{
	test_page_index();
	test_screen_id_known();
	test_page_neighbor();

	printf("Ran %d tests, %d failed\n", tests_run, tests_failed);
	return tests_failed ? 1 : 0;
}
