ifndef CC
CC = gcc
endif

CPPFLAGS := -I SSD1306_OLED_Library -I I2C_Library -I Example_Code
ifndef CFLAGS
CFLAGS := -O2 -Wall
endif

# oled: display demo binary (libconfig)
LDFLAGS := -lpthread -lconfig
# oledd: menu daemon (ubus); keep separate from oled link flags
OLEDD_LDFLAGS ?= -lpthread -lubus -lubox -lblobmsg_json

DRIVER_SRCS := SSD1306_OLED_Library/SSD1306_OLED.c SSD1306_OLED_Library/sh1106.c I2C_Library/I2C.c
DRIVER_OBJS := $(DRIVER_SRCS:.c=.o)

OLED_SRCS := Example_Code/main.c Example_Code/example_app.c
OLED_OBJS := $(OLED_SRCS:.c=.o)

OLEDD_SRCS := \
	oledd/oledd.c \
	oledd/oledd_config.c \
	oledd/oledd_data.c \
	oledd/oledd_fonts.c \
	oledd/oledd_icons.c \
	oledd/oledd_input.c \
	oledd/oledd_menu.c \
	oledd/oledd_net.c \
	oledd/oledd_pages.c \
	oledd/oledd_ubus.c \
	oledd/oledd_ubus_srv.c \
	oledd/oledd_alert.c
OLEDD_OBJS := $(OLEDD_SRCS:.c=.o)

OLEDD_BIN := oledd-bin

.PHONY: all clean oled oledd compile install

all: oled oledd

oled: $(DRIVER_OBJS) $(OLED_OBJS)
	$(CC) $^ -o $@ $(LDFLAGS)

# Do not link -o oledd: that path is the oledd/ source directory.
oledd: $(DRIVER_OBJS) $(OLEDD_OBJS)
	$(CC) $^ -o $(OLEDD_BIN) $(OLEDD_LDFLAGS)

compile: all

install: compile
	mkdir -p $(DESTDIR)/usr/bin $(DESTDIR)/usr/sbin
	cp oled $(DESTDIR)/usr/bin/oled
	cp $(OLEDD_BIN) $(DESTDIR)/usr/sbin/oledd

SSD1306_OLED_Library/%.o: SSD1306_OLED_Library/%.c
	$(CC) $(CPPFLAGS) $(CFLAGS) -c -o $@ $<

I2C_Library/%.o: I2C_Library/%.c
	$(CC) $(CPPFLAGS) $(CFLAGS) -c -o $@ $<

Example_Code/%.o: Example_Code/%.c
	$(CC) $(CPPFLAGS) $(CFLAGS) -c -o $@ $<

oledd/%.o: oledd/%.c
	$(CC) $(CPPFLAGS) $(CFLAGS) -c -o $@ $<

clean:
	rm -rf oled $(OLEDD_BIN) $(DRIVER_OBJS) $(OLED_OBJS) $(OLEDD_OBJS)
