/*
 * oledd_input — FIFO event reader (Phase 3).
 */

#ifndef OLEDD_INPUT_H
#define OLEDD_INPUT_H

typedef enum {
	OLEDD_EV_NONE = 0,
	OLEDD_EV_NET,
	OLEDD_EV_UP,
	OLEDD_EV_DOWN,
	OLEDD_EV_OK,
	OLEDD_EV_BACK,
	OLEDD_EV_NEXT,
	OLEDD_EV_REFRESH,
} oledd_event_t;

int oledd_input_init(void);
void oledd_input_close(void);
oledd_event_t oledd_input_poll(void);

#endif /* OLEDD_INPUT_H */
