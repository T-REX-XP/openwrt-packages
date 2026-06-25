/*
 * oledd_pages — JSON page config loader and renderer (router OLED spec).
 */

#ifndef OLEDD_PAGES_H
#define OLEDD_PAGES_H

struct ubus_context;

int oledd_pages_load(const char *path);
void oledd_pages_free(void);
int oledd_pages_count(void);
const char *oledd_pages_id(int idx);
const char *oledd_pages_tab_icon(int idx);
int oledd_pages_index_by_id(const char *id);
void oledd_pages_render(int page_idx, struct ubus_context *ubus,
			double elapsed_sec);
void oledd_pages_draw_indicator(int current, int total);

#endif /* OLEDD_PAGES_H */
