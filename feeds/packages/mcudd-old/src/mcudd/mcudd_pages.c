#include "mcudd_pages.h"

#include <string.h>

static const char *const PAGE_IDS[MCUDD_PAGE_COUNT] = {
	"router_system",
	"router_network",
	"router_clients",
	"router_storage",
	"router_wifi",
	"router_security",
};

const char *const *mcudd_page_ids(void)
{
	return PAGE_IDS;
}

int mcudd_page_index(const char *screen_id)
{
	int i;

	if (!screen_id || !screen_id[0])
		return -1;
	for (i = 0; i < MCUDD_PAGE_COUNT; i++) {
		if (!strcmp(PAGE_IDS[i], screen_id))
			return i;
	}
	return -1;
}

int mcudd_screen_id_known(const char *screen_id)
{
	if (!screen_id || !screen_id[0])
		return 0;
	if (!strcmp(screen_id, MCUDD_BOOT_SCREEN))
		return 1;
	return mcudd_page_index(screen_id) >= 0;
}

const char *mcudd_page_neighbor(const char *screen_id, const char *dir)
{
	int idx;

	if (!screen_id || !strcmp(screen_id, MCUDD_BOOT_SCREEN))
		return PAGE_IDS[0];

	idx = mcudd_page_index(screen_id);
	if (idx < 0)
		idx = 0;
	if (!dir || !strcmp(dir, "left"))
		return PAGE_IDS[(idx + 1) % MCUDD_PAGE_COUNT];
	return PAGE_IDS[(idx + MCUDD_PAGE_COUNT - 1) % MCUDD_PAGE_COUNT];
}
