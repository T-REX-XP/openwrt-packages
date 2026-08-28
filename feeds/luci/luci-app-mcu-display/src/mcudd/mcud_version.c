#include "mcud_version.h"

#include <stdio.h>
#include <string.h>

const char *mcud_version_string(void)
{
	static char buf[32];

	snprintf(buf, sizeof(buf), "%s+%u", MCUD_STACK_VERSION, MCUD_STACK_RELEASE);
	return buf;
}

int mcud_version_compatible(const char *stack, unsigned release, unsigned rdcp)
{
	if (!stack || !stack[0] || rdcp != MCUD_RDCP_VERSION)
		return 0;
	if (strcmp(stack, MCUD_STACK_VERSION) != 0)
		return 0;
	if (release != MCUD_STACK_RELEASE)
		return 0;
	return 1;
}
