#ifndef MCUDD_PAGES_H
#define MCUDD_PAGES_H

#define MCUDD_PAGE_COUNT 6
#define MCUDD_BOOT_SCREEN "router_boot"

int mcudd_page_index(const char *screen_id);
int mcudd_screen_id_known(const char *screen_id);
const char *mcudd_page_neighbor(const char *screen_id, const char *dir);
const char *const *mcudd_page_ids(void);

#endif
