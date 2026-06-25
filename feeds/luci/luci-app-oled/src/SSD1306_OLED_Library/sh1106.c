/*
 * SH1106 128x64 I2C @ 0x3c — page addressing, column offset 2.
 *
 * Init + flush from karabek/OrangePi-OLED (luma.oled fork, MIT):
 *   https://github.com/karabek/OrangePi-OLED/blob/master/oled/device.py
 */

#include "sh1106.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "I2C.h"

extern I2C_DeviceT I2C_DEV_2;

static unsigned char chunk[17];

typedef struct {
	uint8_t cmd;
	uint8_t arg;
	uint8_t has_arg;
} sh1106_init_step_t;

static int sh1106_cmd(unsigned char cmd)
{
	if (i2c_write_register(I2C_DEV_2.fd_i2c, OLED_CNTRL_CMD, cmd) !=
	    I2C_TWO_BYTES) {
		fprintf(stderr, "oledd: sh1106 cmd 0x%02x failed\n", cmd);
		return -1;
	}
	return 0;
}

/*
 * karabek/OrangePi-OLED sh1106.__init__ command list (byte-for-byte).
 * AE 20 10 B0 C8 00 10 40 81 7F A1 A6 A8 3F A4 D3 00 D5 F0 D9 22 DA 12 DB 20 8D 14 AF
 */
static const sh1106_init_step_t sh1106_init_seq[] = {
    {0xAE, 0x00, 0}, /* display off */
    {0x20, 0x00, 0}, /* memory mode (luma/karabek) */
    {0x10, 0x00, 0}, /* set high column addr */
    {0xB0, 0x00, 0}, /* page 0 */
    {0xC8, 0x00, 0}, /* COM scan dec */
    {0x00, 0x00, 0}, /* set low column addr */
    {0x10, 0x00, 0}, /* column addr high nibble */
    {0x40, 0x00, 0}, /* start line 0 */
    {0x81, 0x7F, 1}, /* contrast */
    {0xA1, 0x00, 0}, /* segment remap */
    {0xA6, 0x00, 0}, /* normal display */
    {0xA8, 0x3F, 1}, /* multiplex 64 */
    {0xA4, 0x00, 0}, /* resume from RAM */
    {0xD3, 0x00, 1}, /* display offset */
    {0xD5, 0xF0, 1}, /* clock divide */
    {0xD9, 0x22, 1}, /* pre-charge */
    {0xDA, 0x12, 1}, /* COM pins 128x64 */
    {0xDB, 0x20, 1}, /* VCOM detect */
    {0x8D, 0x14, 1}, /* charge pump on (karabek; not SH1106 0xAD DC-DC) */
    {0xAF, 0x00, 0}, /* display on */
};

int sh1106_init(void)
{
	for (size_t i = 0; i < sizeof(sh1106_init_seq) / sizeof(sh1106_init_seq[0]);
	     i++) {
		if (sh1106_cmd(sh1106_init_seq[i].cmd) != 0)
			return -1;
		if (sh1106_init_seq[i].has_arg &&
		    sh1106_cmd(sh1106_init_seq[i].arg) != 0)
			return -1;
	}
	return 0;
}

int sh1106_upload(const uint8_t *screen, size_t buf_len)
{
	unsigned char page;
	size_t index = 0;
	const unsigned char col_lo = SH1106_COL_OFFSET & 0x0F;
	const unsigned char col_hi = 0x10 | ((SH1106_COL_OFFSET >> 4) & 0x0F);

	if (!screen || buf_len < (size_t)SH1106_WIDTH * SH1106_PAGES)
		return -1;

	for (page = 0; page < SH1106_PAGES; page++) {
		if (sh1106_cmd(0xB0 | (page & 0x0F)) != 0)
			return -1;
		if (sh1106_cmd(col_lo) != 0)
			return -1;
		if (sh1106_cmd(col_hi) != 0)
			return -1;

		size_t remaining = SH1106_WIDTH;
		while (remaining > 0) {
			size_t chunk_data = remaining > 16 ? 16 : remaining;

			chunk[0] = OLED_CNTRL_DATA;
			for (size_t n = 0; n < chunk_data; n++)
				chunk[n + 1] = screen[index++];
			if (i2c_multiple_writes(I2C_DEV_2.fd_i2c,
						(int)(chunk_data + 1),
						chunk) != (int)(chunk_data + 1))
				return -1;
			remaining -= chunk_data;
			memset(chunk, 0x00, sizeof(chunk));
		}
	}
	return 0;
}

int sh1106_set_rotation(int normal)
{
	if (normal) {
		if (sh1106_cmd(0xA1) != 0)
			return -1;
		if (sh1106_cmd(0xC8) != 0)
			return -1;
	} else {
		if (sh1106_cmd(0xA0) != 0)
			return -1;
		if (sh1106_cmd(0xC0) != 0)
			return -1;
	}
	return 0;
}
