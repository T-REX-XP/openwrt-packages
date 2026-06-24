/*
 * MIT License

Copyright (c) 2017 DeeplyEmbedded

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

 * SSD1306_OLED.h
 *
 *  Created on : Sep 21, 2017
 *  Author     : Vinay Divakar
 *  Website    : www.deeplyembedded.org
 */

#ifndef SSD1306_OLED_H_
#define SSD1306_OLED_H_

/* Lib's */
#include <stdbool.h>
#include <stddef.h>

/* Find Min and Max - MACROS */
#define MIN(a, b) (((a) < (b)) ? (a) : (b))
#define MAX(a, b) (((a) > (b)) ? (a) : (b))

/* I2C Address (SSD1306 / SH1106) */
#define SSD1306_OLED_ADDR 0x3C

/* Runtime panel geometry (set via display_set_chip() before init) */
short oled_lcd_width(void);
short oled_lcd_height(void);
size_t oled_display_buf_size(void);
void display_set_chip(const char *chip);

/* COLOR MACROS */
#define WHITE 1
#define BLACK 0
#define INVERSE 2

/* Number output format */
#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2
#define DEFAULT 0

/*D/C# bit is '0' indicating that following
 * byte is a command. '1' is for data
 */
#define SSD1306_CNTRL_CMD 0x00
#define SSD1306_CNTRL_DATA 0x40

/* Default panel profile if display_set_chip() is not called */
#define OLED_DEFAULT_CHIP "ssd1306_128x32"

/* SSD1306 Commands */
#define SSD1306_DISPLAY_OFF 0xAE
#define SSD1306_SET_DISP_CLK 0xD5
#define SSD1306_SET_MULTIPLEX 0xA8
#define SSD1306_SET_DISP_OFFSET 0xD3
#define SSD1306_SET_DISP_START_LINE 0x40
#define SSD1306_CONFIG_CHARGE_PUMP 0x8D
#define SSD1306_SET_MEM_ADDR_MODE 0x20
#define SSD1306_SEG_REMAP (0xA0 | 0x01)
#define SSD1306_SEG_REMAP1 0xA0
#define SSD1306_SET_COMSCANDEC 0xC8
#define SSD1306_SET_COMSCANDEC1 0xC0
#define SSD1306_SET_COMPINS 0xDA
#define SSD1306_SET_CONTRAST 0x81
#define SSD1306_SET_PRECHARGE 0xD9
#define SSD1306_SET_VCOMDETECT 0xDB
#define SSD1306_DISPLAYALLON_RESUME 0xA4
#define SSD1306_NORMAL_DISPLAY 0xA6
#define SSD1306_DISPLAYON 0xAF
#define SSD1306_SET_COL_ADDR 0x21
#define SSD1306_PAGEADDR 0x22
#define SSD1306_INVERT_DISPLAY 0x01
#define SSD1306_NORMALIZE_DISPLAY 0x00

/* SDD1306 Scroll Commands */
#define SSD1306_SET_VERTICAL_SCROLL_AREA 0xA3
#define SSD1306_ACTIVATE_SCROLL 0x2F
#define SSD1306_DEACTIVATE_SCROLL 0x2E
#define SSD1306_RIGHT_HORIZONTAL_SCROLL 0x26
#define SSD1306_LEFT_HORIZONTAL_SCROLL 0x27
#define SSD1306_VERTICAL_AND_RIGHT_HORIZONTAL_SCROLL 0x29
#define SSD1306_VERTICAL_AND_LEFT_HORIZONTAL_SCROLL 0x2A
#define SSD1306_INVERTDISPLAY 0xA7

/* SSD1306 Configuration Commands */
#define SSD1306_DISPCLK_DIV 0x80
#define SSD1306_DISP_OFFSET_VAL 0x00
#define SSD1306_PG_START_ADDR 0x00
#define SSD1306_CHARGE_PUMP_EN 0x14
/* SH1106: DC-DC on (replaces SSD1306 charge pump 0x8D 0x14) */
#define SH1106_SET_DCDC 0xAD
#define SH1106_DCDC_ON 0x8B
#define SSD1306_CONTRAST_VAL 0xCF  // 207
#define SSD1306_PRECHARGE_VAL 0xF1
#define SSD1306_VCOMH_VAL 0x40
#define SSD1306_HOR_MM 0x00

/*SSD1306 Display API's */
extern void clearDisplay();
extern void display_Init_seq();
extern void Display();
extern void Init_Col_PG_addrs(unsigned char col_start_addr,
			      unsigned char col_end_addr,
			      unsigned char pg_start_addr,
			      unsigned char pg_end_addr);
extern void setRotation(unsigned char x);
extern void startscrollright(unsigned char start, unsigned char stop);
extern void startscrollleft(unsigned char start, unsigned char stop);
extern void startscrolldiagright(unsigned char start, unsigned char stop);
extern void startscrolldiagleft(unsigned char start, unsigned char stop);
extern void stopscroll();
extern void setCursor(short x, short y);
extern short getCursorX();
extern short getCursorY();
extern unsigned char getRotation();
extern void invertDisplay(unsigned char i);
extern void display_rotate();
extern void display_normal();

/*SSD1306 Graphics Handling API's */
extern signed char drawPixel(short x, short y, short color);
extern void writeLine(short x0, short y0, short x1, short y1, short color);
extern void drawCircleHelper(short x0, short y0, short r,
			     unsigned char cornername, short color);
extern void drawLine(short x0, short y0, short x1, short y1, short color);
extern void drawRect(short x, short y, short w, short h, short color);
extern void fillRect(short x, short y, short w, short h, short color);
extern void drawCircle(short x0, short y0, short r, short color);
extern void fillCircleHelper(short x0, short y0, short r,
			     unsigned char cornername, short delta,
			     short color);
extern void fillCircle(short x0, short y0, short r, short color);
extern void drawTriangle(short x0, short y0, short x1, short y1, short x2,
			 short y2, short color);
extern void fillTriangle(short x0, short y0, short x1, short y1, short x2,
			 short y2, short color);
extern void drawRoundRect(short x, short y, short w, short h, short r,
			  short color);
extern void fillRoundRect(short x, short y, short w, short h, short r,
			  short color);
extern void drawBitmap(short x, short y, const unsigned char bitmap[], short w,
		       short h, short color);
extern short oled_write(unsigned char c);

/*SSD1306 Text and Character Handling API's */
extern void setTextSize(unsigned char s);
extern void setTextColor(short c);
extern void setTextWrap(bool w);
extern void drawChar(short x, short y, unsigned char c, short color, short bg,
		     unsigned char size);
extern short print_str(const unsigned char *strPtr);
extern short println();
extern short print_strln(const unsigned char *strPtr);

/*SSD1306 Number Handling API's */
extern short printNumber(unsigned long n, unsigned char base);
extern short printNumber_UL(unsigned long n, int base);
extern short printNumber_UL_ln(unsigned long num, int base);
extern short printNumber_UI(unsigned int n, int base);
extern short printNumber_UI_ln(unsigned int n, int base);
extern short printNumber_UC(unsigned char b, int base);
extern short printNumber_UC_ln(unsigned char b, int base);
extern short printNumber_L(long n, int base);
extern short printNumber_L_ln(long num, int base);
extern short printNumber_I(int n, int base);
extern short printNumber_I_ln(int n, int base);
extern short printFloat(double number, unsigned char digits);
extern short printFloat_ln(double num, int digits);
#endif /* SSD1306_OLED_H_ */
