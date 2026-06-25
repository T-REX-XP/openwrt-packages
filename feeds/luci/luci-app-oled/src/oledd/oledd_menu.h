/*
 * oledd_menu — interactive menu state machine (Phase 3).
 */

#ifndef OLEDD_MENU_H
#define OLEDD_MENU_H

struct ubus_context;

#include "oledd_input.h"

void oledd_menu_init(int interactive, int menu_wifi, unsigned view_timeout,
		     struct ubus_context *ubus);
void oledd_menu_set_ubus(struct ubus_context *ubus);
int oledd_menu_tick(double elapsed_sec, oledd_event_t evt);
void oledd_menu_render(double elapsed_sec);

#endif /* OLEDD_MENU_H */
