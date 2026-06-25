/*
 * oledd_qrcode — encode and draw QR symbols on the OLED framebuffer.
 */

#ifndef OLEDD_QRCODE_H
#define OLEDD_QRCODE_H

int oledd_qrcode_draw(int x, int y, int max_size, const char *text);

#endif /* OLEDD_QRCODE_H */
