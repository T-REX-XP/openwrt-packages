ifndef CC
CC = gcc
endif

ifndef CFLAGS
CFLAGS := -O2 -Wall -Wextra -std=c99 -D_GNU_SOURCE
endif

LDFLAGS ?= -lpthread
LDFLAGS_STATIC ?= -static

VERSION_JSON := ../mcud-version.json
GEN_SCRIPT := ../scripts/gen-mcud-version.sh
VERSION_HDR := mcudd/mcud_version.h

MCUDD_SRCS := \
	mcudd/mcudd.c \
	mcudd/mcudd_pages.c \
	mcudd/mcudd_config.c \
	mcudd/mcudd_log.c \
	mcudd/mcudd_serial.c \
	mcudd/mcudd_protocol.c \
	mcudd/mcudd_metrics.c \
	mcudd/mcud_version.c
MCUDD_OBJS := $(MCUDD_SRCS:.c=.o)

MCUDD_BIN := mcudd-bin

.PHONY: all clean test compile

all: $(MCUDD_BIN)

compile: all

install: compile
	mkdir -p $(DESTDIR)/usr/sbin
	cp $(MCUDD_BIN) $(DESTDIR)/usr/sbin/mcudd

$(VERSION_HDR): $(VERSION_JSON) $(GEN_SCRIPT)
	sh $(GEN_SCRIPT) $(VERSION_JSON) $(VERSION_HDR)

$(MCUDD_BIN): $(MCUDD_OBJS) $(VERSION_HDR)
	$(CC) $(MCUDD_OBJS) -o $@ $(LDFLAGS)

mcudd/%.o: mcudd/%.c $(VERSION_HDR)
	$(CC) $(CFLAGS) -I mcudd -c -o $@ $<

test:
	$(MAKE) -C ../tests

clean:
	rm -rf $(MCUDD_BIN) $(MCUDD_OBJS) $(VERSION_HDR)
