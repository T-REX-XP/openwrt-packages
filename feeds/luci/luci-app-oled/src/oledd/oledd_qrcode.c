/*
 * oledd_qrcode — encode and draw QR symbols on the OLED framebuffer.
 */

#include "oledd_qrcode.h"

#include "qrcodegen.h"
#include "SSD1306_OLED.h"

#include <string.h>

#define OLEDD_QR_MAX_VER 6

int oledd_qrcode_draw(int x, int y, int max_size, const char *text)
{
	uint8_t qrcode[qrcodegen_BUFFER_LEN_FOR_VERSION(OLEDD_QR_MAX_VER)];
	uint8_t temp[qrcodegen_BUFFER_LEN_FOR_VERSION(OLEDD_QR_MAX_VER)];
	int qr_size, scale, draw_size, px, py, mx, my;
	int ox, oy;

	if (!text || !text[0] || max_size < 8)
		return -1;

	if (!qrcodegen_encodeText(text, temp, qrcode, qrcodegen_Ecc_LOW,
				1, OLEDD_QR_MAX_VER, qrcodegen_Mask_AUTO,
				true))
		return -1;

	qr_size = qrcodegen_getSize(qrcode);
	scale = max_size / qr_size;
	if (scale < 1)
		scale = 1;
	draw_size = qr_size * scale;
	ox = x + (max_size - draw_size) / 2;
	oy = y + (max_size - draw_size) / 2;

	for (my = 0; my < qr_size; my++) {
		for (mx = 0; mx < qr_size; mx++) {
			if (!qrcodegen_getModule(qrcode, mx, my))
				continue;
			for (py = 0; py < scale; py++) {
				for (px = 0; px < scale; px++) {
					drawPixel(ox + mx * scale + px,
						  oy + my * scale + py, WHITE);
				}
			}
		}
	}

	return draw_size;
}
