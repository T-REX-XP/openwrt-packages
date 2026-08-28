/* Auto-generated from mcud-version.json — do not edit. */
#ifndef MCUD_VERSION_H
#define MCUD_VERSION_H

#define MCUD_RDCP_VERSION 1u
#define MCUD_STACK_VERSION "1.0.0"
#define MCUD_STACK_RELEASE 35u
#define MCUD_PAGES_SCHEMA 1u
#define MCUD_COMPONENT_HOST "mcudd"
#define MCUD_COMPONENT_FIRMWARE "esp32-router"

const char *mcud_version_string(void);
int mcud_version_compatible(const char *stack, unsigned release, unsigned rdcp);

#endif
