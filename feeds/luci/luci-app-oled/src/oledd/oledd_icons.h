/*
 * oledd_icons — bitmap icon library (router OLED spec).
 */

#ifndef OLEDD_ICONS_H
#define OLEDD_ICONS_H

#include <stdint.h>

struct oledd_icon {
	const char *name;
	int size;
	int w;
	int h;
	const uint8_t *rows; /* row-major, MSB = left pixel */
};

const struct oledd_icon *oledd_icon_get(const char *name, int size);
void oledd_icon_draw(int x, int y, const char *name, int size);

#endif /* OLEDD_ICONS_H */
