ifndef CC
CC = gcc
endif

CPPFLAGS := -I SSD1306_OLED_Library -I I2C_Library -I Example_Code
ifndef CFLAGS
CFLAGS := -O2 -Wall
endif
LDFLAGS := -lpthread -lconfig

DRIVER_SRCS := SSD1306_OLED_Library/SSD1306_OLED.c SSD1306_OLED_Library/sh1106.c I2C_Library/I2C.c
DRIVER_OBJS := $(DRIVER_SRCS:.c=.o)

OLED_SRCS := Example_Code/main.c Example_Code/example_app.c
OLED_OBJS := $(OLED_SRCS:.c=.o)

OLEDD_OBJS := oledd/oledd.o

.PHONY: all clean oled oledd compile install

all: oled oledd

oled: $(DRIVER_OBJS) $(OLED_OBJS)
	$(CC) $^ -o $@ $(LDFLAGS)

oledd: $(DRIVER_OBJS) $(OLEDD_OBJS)
	$(CC) $^ -o $@ $(LDFLAGS)

compile: all

install: compile
	mkdir -p $(DESTDIR)/usr/bin $(DESTDIR)/usr/sbin
	cp oled $(DESTDIR)/usr/bin/oled
	cp oledd $(DESTDIR)/usr/sbin/oledd

%.o: %.c
	$(CC) $(CPPFLAGS) $(CFLAGS) -c -o $@ $<

clean:
	rm -rf oled oledd $(DRIVER_OBJS) $(OLED_OBJS) $(OLEDD_OBJS)
