/*
 * oledd_config — minimal UCI read for menu options (Phase 2/3).
 */

#ifndef OLEDD_CONFIG_H
#define OLEDD_CONFIG_H

#include <stddef.h>

int oledd_config_menu_wifi(void);
int oledd_config_menu_interactive(void);
int oledd_config_menu_alerts(void);
unsigned oledd_config_menu_idle_dim(void);
void oledd_config_menu_nav_button(char *out, size_t len);
void oledd_config_menu_select_button(char *out, size_t len);
void oledd_config_menu_pages_path(char *out, size_t len);

#endif /* OLEDD_CONFIG_H */
