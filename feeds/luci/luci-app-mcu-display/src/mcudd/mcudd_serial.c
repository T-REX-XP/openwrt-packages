/*
 * mcudd_serial — termios UART I/O.
 */

#include "mcudd_serial.h"

#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <termios.h>
#include <unistd.h>

#ifdef __linux__
#include <sys/ioctl.h>
#endif

static speed_t baud_to_flag(int baud)
{
	switch (baud) {
	case 9600:
		return B9600;
	case 19200:
		return B19200;
	case 38400:
		return B38400;
	case 57600:
		return B57600;
	case 115200:
		return B115200;
	case 230400:
		return B230400;
	case 460800:
		return B460800;
	case 921600:
		return B921600;
	default:
		return 0;
	}
}

int mcudd_serial_open(const char *dev, int baud)
{
	struct termios tio;
	speed_t spd;
	int fd;

	if (!dev || !dev[0])
		return -1;

	spd = baud_to_flag(baud);
	if (!spd)
		return -1;

	fd = open(dev, O_RDWR | O_NOCTTY | O_NONBLOCK);
	if (fd < 0)
		return -1;

#ifdef __linux__
	{
		int status = 0;

		if (ioctl(fd, TIOCMGET, &status) == 0) {
			status &= ~(TIOCM_DTR | TIOCM_RTS);
			ioctl(fd, TIOCMSET, &status);
		}
	}
#endif

	if (tcgetattr(fd, &tio) != 0) {
		close(fd);
		return -1;
	}

	cfmakeraw(&tio);
	tio.c_cflag |= CLOCAL | CREAD;
	tio.c_cflag &= ~CRTSCTS;
	cfsetispeed(&tio, spd);
	cfsetospeed(&tio, spd);
	tio.c_cc[VMIN] = 0;
	tio.c_cc[VTIME] = 1;

	if (tcsetattr(fd, TCSANOW, &tio) != 0) {
		close(fd);
		return -1;
	}

	return fd;
}

void mcudd_serial_close(int fd)
{
	if (fd >= 0)
		close(fd);
}

int mcudd_serial_write_line(int fd, const char *line)
{
	size_t len;
	ssize_t n;

	if (fd < 0 || !line)
		return -1;
	len = strlen(line);
	n = write(fd, line, len);
	if (n < 0 || (size_t)n != len)
		return -1;
	n = write(fd, "\n", 1);
	return (n == 1) ? 0 : -1;
}

int mcudd_serial_read_char(int fd, char *ch)
{
	ssize_t n;

	if (fd < 0 || !ch)
		return -1;
	n = read(fd, ch, 1);
	if (n == 1)
		return 1;
	if (n == 0)
		return 0;
	if (errno == EAGAIN || errno == EWOULDBLOCK)
		return 0;
	return -1;
}
