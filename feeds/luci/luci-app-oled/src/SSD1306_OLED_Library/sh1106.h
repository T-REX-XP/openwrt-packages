/*
 * SH1106 128x64 I2C helpers for Waveshare 1.3" HAT (132 cols, 2-col offset).
 * Init/flush from karabek/OrangePi-OLED (luma.oled fork).
 */

#ifndef SH1106_H_
#define SH1106_H_

#include <stddef.h>
#include <stdint.h>

#define SH1106_COL_OFFSET 2
#define SH1106_WIDTH 128
#define SH1106_HEIGHT 64
#define SH1106_PAGES 8

void sh1106_init(void);
void sh1106_upload(const uint8_t *screen, size_t buf_len);

#endif /* SH1106_H_ */
