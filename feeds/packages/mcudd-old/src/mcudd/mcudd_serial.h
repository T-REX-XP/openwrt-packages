/*
 * mcudd_serial — termios UART I/O (DTR/RTS low on open).
 */

#ifndef MCUDD_SERIAL_H
#define MCUDD_SERIAL_H

#include <stddef.h>

int mcudd_serial_open(const char *dev, int baud);
void mcudd_serial_close(int fd);
int mcudd_serial_write_line(int fd, const char *line);
int mcudd_serial_read_char(int fd, char *ch);

#endif /* MCUDD_SERIAL_H */
