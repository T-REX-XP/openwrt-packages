/*
 * oledd_fonts — xs/sm/lg bitmap text (router OLED spec).
 */

#include "oledd_fonts.h"

#include "SSD1306_OLED.h"

#include <ctype.h>
#include <string.h>

/* 3×5 uppercase font: 5 column bytes per glyph (bits 4..0 = rows). */
static const uint8_t xs_glyphs[][5] = {
	[' ' - ' '] = { 0, 0, 0, 0, 0 },
	['!' - ' '] = { 0, 0x05, 0x05, 0, 0 },
	['%' - ' '] = { 0x15, 0x0a, 0x04, 0x0a, 0x15 },
	['(' - ' '] = { 0x02, 0x04, 0x04, 0x04, 0x02 },
	[')' - ' '] = { 0x02, 0x01, 0x01, 0x01, 0x02 },
	['+' - ' '] = { 0, 0x04, 0x0e, 0x04, 0 },
	['-' - ' '] = { 0, 0, 0x0e, 0, 0 },
	['.' - ' '] = { 0, 0, 0, 0, 0x04 },
	['/ - ' '] = { 0x01, 0x02, 0x04, 0x08, 0x10 },
	['0' - ' '] = { 0x0e, 0x11, 0x11, 0x11, 0x0e },
	['1' - ' '] = { 0x04, 0x0c, 0x04, 0x04, 0x0e },
	['2' - ' '] = { 0x0e, 0x01, 0x0e, 0x10, 0x0e },
	['3' - ' '] = { 0x0e, 0x01, 0x06, 0x01, 0x0e },
	['4' - ' '] = { 0x11, 0x11, 0x1f, 0x01, 0x01 },
	['5' - ' '] = { 0x1e, 0x10, 0x1e, 0x01, 0x1e },
	['6' - ' '] = { 0x0e, 0x10, 0x1e, 0x11, 0x0e },
	['7' - ' '] = { 0x1f, 0x01, 0x02, 0x04, 0x04 },
	['8' - ' '] = { 0x0e, 0x11, 0x0e, 0x11, 0x0e },
	['9' - ' '] = { 0x0e, 0x11, 0x0f, 0x01, 0x0e },
	[':' - ' '] = { 0, 0x04, 0, 0x04, 0 },
	['A' - ' '] = { 0x0e, 0x11, 0x1f, 0x11, 0x11 },
	['B' - ' '] = { 0x1e, 0x11, 0x1e, 0x11, 0x1e },
	['C' - ' '] = { 0x0e, 0x11, 0x10, 0x11, 0x0e },
	['D' - ' '] = { 0x1e, 0x11, 0x11, 0x11, 0x1e },
	['E' - ' '] = { 0x1f, 0x10, 0x1e, 0x10, 0x1f },
	['F' - ' '] = { 0x1f, 0x10, 0x1e, 0x10, 0x10 },
	['G' - ' '] = { 0x0e, 0x10, 0x17, 0x11, 0x0e },
	['H' - ' '] = { 0x11, 0x11, 0x1f, 0x11, 0x11 },
	['I' - ' '] = { 0x0e, 0x04, 0x04, 0x04, 0x0e },
	['J' - ' '] = { 0x02, 0x02, 0x02, 0x12, 0x0c },
	['K' - ' '] = { 0x11, 0x12, 0x1c, 0x12, 0x11 },
	['L' - ' '] = { 0x10, 0x10, 0x10, 0x10, 0x1f },
	['M' - ' '] = { 0x11, 0x1b, 0x15, 0x11, 0x11 },
	['N' - ' '] = { 0x11, 0x19, 0x15, 0x13, 0x11 },
	['O' - ' '] = { 0x0e, 0x11, 0x11, 0x11, 0x0e },
	['P' - ' '] = { 0x1e, 0x11, 0x1e, 0x10, 0x10 },
	['Q' - ' '] = { 0x0e, 0x11, 0x11, 0x13, 0x0d },
	['R' - ' '] = { 0x1e, 0x11, 0x1e, 0x14, 0x13 },
	['S' - ' '] = { 0x0f, 0x10, 0x0e, 0x01, 0x1e },
	['T' - ' '] = { 0x1f, 0x04, 0x04, 0x04, 0x04 },
	['U' - ' '] = { 0x11, 0x11, 0x11, 0x11, 0x0e },
	['V' - ' '] = { 0x11, 0x11, 0x11, 0x0a, 0x04 },
	['W' - ' '] = { 0x11, 0x11, 0x15, 0x1b, 0x11 },
	['X' - ' '] = { 0x11, 0x0a, 0x04, 0x0a, 0x11 },
	['Y' - ' '] = { 0x11, 0x11, 0x0a, 0x04, 0x04 },
	['Z' - ' '] = { 0x1f, 0x02, 0x04, 0x08, 0x1f },
	['_' - ' '] = { 0, 0, 0, 0, 0x1f },
};

/* 10×14 seven-segment segments per digit (simplified box digits). */
static const uint16_t seg_mask[10] = {
	0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f
};

static unsigned char map_char(unsigned char c)
{
	if (c >= 'a' && c <= 'z')
		c = (unsigned char)toupper(c);
	return c;
}

int oledd_font_width(oledd_font_t font)
{
	switch (font) {
	case OLEDD_FONT_LG:
		return 10;
	case OLEDD_FONT_SM:
		return 6;
	case OLEDD_FONT_XS:
	default:
		return 4;
	}
}

int oledd_font_height(oledd_font_t font)
{
	switch (font) {
	case OLEDD_FONT_LG:
		return 14;
	case OLEDD_FONT_SM:
		return 8;
	case OLEDD_FONT_XS:
	default:
		return 5;
	}
}

static void draw_xs_char(int x, int y, unsigned char c, int invert)
{
	const uint8_t *g;
	int col, row;

	c = map_char(c);
	if (c < ' ' || c > '_')
		c = ' ';
	g = xs_glyphs[c - ' '];
	for (col = 0; col < 3; col++) {
		uint8_t colbits = g[col];

		for (row = 0; row < 5; row++) {
			int on = colbits & (1 << row);

			if (on)
				drawPixel(x + col, y + row, invert ? BLACK : WHITE);
		}
	}
}

static void draw_lg_char(int x, int y, unsigned char c)
{
	uint16_t mask;

	c = map_char(c);
	if (c < '0' || c > '9')
		return;
	mask = seg_mask[c - '0'];
	/* horizontal segments */
	if (mask & 0x01)
		fillRect(x + 2, y, 6, 2, WHITE);
	if (mask & 0x02)
		fillRect(x + 8, y + 2, 2, 4, WHITE);
	if (mask & 0x04)
		fillRect(x + 2, y + 6, 6, 2, WHITE);
	if (mask & 0x08)
		fillRect(x, y + 2, 2, 4, WHITE);
	if (mask & 0x10)
		fillRect(x + 8, y + 8, 2, 4, WHITE);
	if (mask & 0x20)
		fillRect(x + 2, y + 12, 6, 2, WHITE);
	if (mask & 0x40)
		fillRect(x, y + 8, 2, 4, WHITE);
}

static void draw_sm_char(int x, int y, unsigned char c, int invert)
{
	short fg = invert ? BLACK : WHITE;
	short bg = invert ? WHITE : BLACK;

	drawChar(x, y, map_char(c), fg, bg, 1);
}

int oledd_font_text_width(oledd_font_t font, const char *text)
{
	int spacing = (font == OLEDD_FONT_LG) ? 2 : 1;
	int w = oledd_font_width(font);

	if (!text)
		return 0;
	return (int)strlen(text) * (w + spacing) - spacing;
}

void oledd_font_draw(oledd_font_t font, int x, int y, const char *text,
		     int invert)
{
	int spacing = 1;
	int cx = x;
	const char *p;

	if (!text)
		return;
	if (font == OLEDD_FONT_LG)
		spacing = 2;

	for (p = text; *p; p++) {
		unsigned char c = (unsigned char)*p;

		switch (font) {
		case OLEDD_FONT_LG:
			draw_lg_char(cx, y, c);
			cx += 10 + spacing;
			break;
		case OLEDD_FONT_SM:
			draw_sm_char(cx, y, c, invert);
			cx += 6 + spacing;
			break;
		case OLEDD_FONT_XS:
		default:
			draw_xs_char(cx, y, c, invert);
			cx += 4;
			break;
		}
	}
}

void oledd_font_draw_aligned(oledd_font_t font, int x, int y, int anchor_x,
			     const char *align, const char *text, int invert)
{
	int tw = oledd_font_text_width(font, text);
	int dx = x;

	if (align && !strcmp(align, "right"))
		dx = anchor_x - tw;
	else if (align && !strcmp(align, "center"))
		dx = anchor_x - tw / 2;

	oledd_font_draw(font, dx, y, text, invert);
}
