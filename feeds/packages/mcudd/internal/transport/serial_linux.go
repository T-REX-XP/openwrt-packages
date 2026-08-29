//go:build linux

package transport

import (
	"errors"
	"fmt"
	"os"
	"time"

	"golang.org/x/sys/unix"
)

// Serial is a raw unix fd UART — deliberately not os.File, so the Go
// runtime netpoller cannot steal edge/level notifications from unix.Poll.
type Serial struct {
	fd int
}

func OpenSerial(path string, baud int) (*Serial, error) {
	fd, err := unix.Open(path, unix.O_RDWR|unix.O_NOCTTY|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}

	tio, err := unix.IoctlGetTermios(fd, unix.TCGETS)
	if err != nil {
		_ = unix.Close(fd)
		return nil, fmt.Errorf("tcgets %s: %w", path, err)
	}
	rate, ok := baudFlag(baud)
	if !ok {
		_ = unix.Close(fd)
		return nil, fmt.Errorf("unsupported baud %d", baud)
	}

	// Raw 8N1, no flow control — mirror C cfmakeraw + CLOCAL|CREAD.
	tio.Iflag &^= unix.IGNBRK | unix.BRKINT | unix.PARMRK | unix.ISTRIP | unix.INLCR | unix.IGNCR | unix.ICRNL | unix.IXON
	tio.Oflag &^= unix.OPOST
	tio.Lflag &^= unix.ECHO | unix.ECHONL | unix.ICANON | unix.ISIG | unix.IEXTEN
	tio.Cflag &^= unix.CSIZE | unix.PARENB | unix.CRTSCTS | unix.CBAUD | unix.CBAUDEX
	tio.Cflag |= unix.CS8 | unix.CREAD | unix.CLOCAL | rate
	tio.Cc[unix.VMIN] = 0
	tio.Cc[unix.VTIME] = 0
	tio.Ispeed = rate
	tio.Ospeed = rate
	if err := unix.IoctlSetTermios(fd, unix.TCSETS, tio); err != nil {
		_ = unix.Close(fd)
		return nil, fmt.Errorf("tcsets %s: %w", path, err)
	}

	// Drop DTR/RTS so USB-UART adapters do not hold ESP32 in reset (same as C).
	status, err := unix.IoctlGetInt(fd, unix.TIOCMGET)
	if err == nil {
		status &^= unix.TIOCM_DTR | unix.TIOCM_RTS
		_ = unix.IoctlSetInt(fd, unix.TIOCMSET, status)
	}

	_ = unix.IoctlSetInt(fd, unix.TCFLSH, unix.TCIOFLUSH)
	return &Serial{fd: fd}, nil
}

func baudFlag(baud int) (uint32, bool) {
	switch baud {
	case 9600:
		return unix.B9600, true
	case 19200:
		return unix.B19200, true
	case 38400:
		return unix.B38400, true
	case 57600:
		return unix.B57600, true
	case 115200:
		return unix.B115200, true
	case 230400:
		return unix.B230400, true
	case 460800:
		return unix.B460800, true
	case 921600:
		return unix.B921600, true
	default:
		return 0, false
	}
}

func (s *Serial) writeAll(buf []byte) error {
	for len(buf) > 0 {
		n, err := unix.Write(s.fd, buf)
		if n > 0 {
			buf = buf[n:]
			continue
		}
		if err == nil {
			continue
		}
		if !errors.Is(err, unix.EAGAIN) && !errors.Is(err, unix.EWOULDBLOCK) {
			return err
		}
		pfd := []unix.PollFd{{Fd: int32(s.fd), Events: unix.POLLOUT}}
		if _, perr := unix.Poll(pfd, 1000); perr != nil && perr != unix.EINTR {
			return perr
		}
	}
	return nil
}

func (s *Serial) WriteLine(line string) error {
	return s.writeAll(append([]byte(line), '\n'))
}

func (s *Serial) ReadByte() (byte, error) {
	var b [1]byte
	for {
		n, err := unix.Read(s.fd, b[:])
		if n == 1 {
			return b[0], nil
		}
		if err == nil {
			continue
		}
		if errors.Is(err, unix.EAGAIN) || errors.Is(err, unix.EWOULDBLOCK) {
			return 0, os.ErrDeadlineExceeded
		}
		if errors.Is(err, unix.EINTR) {
			time.Sleep(time.Millisecond)
			continue
		}
		return 0, err
	}
}

func (s *Serial) Close() error {
	if s.fd < 0 {
		return nil
	}
	err := unix.Close(s.fd)
	s.fd = -1
	return err
}

func (s *Serial) Fd() int { return s.fd }
