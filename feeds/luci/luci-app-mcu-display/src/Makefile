ifndef CC
CC = gcc
endif

ifndef CFLAGS
CFLAGS := -O2 -Wall -Wextra -std=c99
endif

LDFLAGS ?= -lpthread

MCUDD_SRCS := \
	mcudd/mcudd.c \
	mcudd/mcudd_pages.c \
	mcudd/mcudd_config.c \
	mcudd/mcudd_log.c \
	mcudd/mcudd_serial.c \
	mcudd/mcudd_protocol.c \
	mcudd/mcudd_metrics.c
MCUDD_OBJS := $(MCUDD_SRCS:.c=.o)

MCUDD_BIN := mcudd-bin

.PHONY: all clean test compile

all: $(MCUDD_BIN)

compile: all

install: compile
	mkdir -p $(DESTDIR)/usr/sbin
	cp $(MCUDD_BIN) $(DESTDIR)/usr/sbin/mcudd

$(MCUDD_BIN): $(MCUDD_OBJS)
	$(CC) $^ -o $@ $(LDFLAGS)

mcudd/%.o: mcudd/%.c
	$(CC) $(CFLAGS) -c -o $@ $<

test:
	$(MAKE) -C ../tests

clean:
	rm -rf $(MCUDD_BIN) $(MCUDD_OBJS)
