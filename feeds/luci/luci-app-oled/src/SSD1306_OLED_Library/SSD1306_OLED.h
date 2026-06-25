/*
 * MIT License — DeeplyEmbedded SSD1306 graphics API, adapted for SH1106 128×64.
 */

#ifndef SSD1306_OLED_H_
#define SSD1306_OLED_H_

#include <stdbool.h>
#include <stddef.h>

#include "sh1106.h"

#define MIN(a, b) (((a) < (b)) ? (a) : (b))
#define MAX(a, b) (((a) > (b)) ? (a) : (b))

#define SSD1306_OLED_ADDR OLED_I2C_ADDR
#define SSD1306_CNTRL_CMD OLED_CNTRL_CMD
#define SSD1306_CNTRL_DATA OLED_CNTRL_DATA

short oled_lcd_width(void);
short oled_lcd_height(void);
size_t oled_display_buf_size(void);

#define WHITE 1
#define BLACK 0
#define INVERSE 2

#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2
#define DEFAULT 0

#define SSD1306_INVERTDISPLAY 0xA7
#define SSD1306_NORMAL_DISPLAY 0xA6

extern void clearDisplay();
extern int display_Init_seq();
extern int Display();
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

extern void setTextSize(unsigned char s);
extern void setTextColor(short c);
extern void setTextWrap(bool w);
extern void drawChar(short x, short y, unsigned char c, short color, short bg,
		     unsigned char size);
extern short print_str(const unsigned char *strPtr);
extern short println();
extern short print_strln(const unsigned char *strPtr);

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
