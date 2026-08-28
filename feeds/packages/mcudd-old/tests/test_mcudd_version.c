/*
 * Unit tests for mcud_version (host build).
 */

#include <stdio.h>
#include <string.h>

#include "mcud_version.h"

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

int main(void)
{
	const char *ver = mcud_version_string();

	expect(ver != NULL && ver[0] != '\0', "mcud_version_string non-empty");
	expect(strstr(ver, MCUD_STACK_VERSION) != NULL, "version string contains stack");
	expect(strstr(ver, "+") != NULL, "version string contains release suffix");
	expect(mcud_version_compatible(MCUD_STACK_VERSION, MCUD_STACK_RELEASE,
				       MCUD_RDCP_VERSION),
	       "compatible with manifest values");
	expect(!mcud_version_compatible(MCUD_STACK_VERSION, MCUD_STACK_RELEASE + 1,
					MCUD_RDCP_VERSION),
	       "reject mismatched release");
	expect(!mcud_version_compatible("0.0.0", MCUD_STACK_RELEASE,
					MCUD_RDCP_VERSION),
	       "reject mismatched stack");
	expect(!mcud_version_compatible(MCUD_STACK_VERSION, MCUD_STACK_RELEASE,
					MCUD_RDCP_VERSION + 1),
	       "reject mismatched rdcp");
	expect(!mcud_version_compatible(NULL, MCUD_STACK_RELEASE, MCUD_RDCP_VERSION),
	       "reject null stack");
	expect(!mcud_version_compatible("", MCUD_STACK_RELEASE, MCUD_RDCP_VERSION),
	       "reject empty stack");

	printf("\n%d tests, %d failed\n", tests_run, tests_failed);
	return tests_failed ? 1 : 0;
}
