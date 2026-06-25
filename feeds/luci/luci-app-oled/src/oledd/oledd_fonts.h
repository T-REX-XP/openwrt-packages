/*
 * oledd_fonts — xs/sm/lg bitmap text (router OLED spec).
 */

#ifndef OLEDD_FONTS_H
#define OLEDD_FONTS_H

typedef enum {
	OLEDD_FONT_XS = 0,
	OLEDD_FONT_SM,
	OLEDD_FONT_LG,
} oledd_font_t;

int oledd_font_width(oledd_font_t font);
int oledd_font_height(oledd_font_t font);
int oledd_font_text_width(oledd_font_t font, const char *text);
void oledd_font_draw(oledd_font_t font, int x, int y, const char *text,
		     int invert);
void oledd_font_draw_aligned(oledd_font_t font, int x, int y, int anchor_x,
			     const char *align, const char *text, int invert);

#endif /* OLEDD_FONTS_H */
