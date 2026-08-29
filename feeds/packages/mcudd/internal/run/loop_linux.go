//go:build linux

package run

import (
	"errors"
	"io"
	"os"
	"time"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/daemon"
	fifopkg "github.com/t-rex-xp/openwrt-packages/mcudd/internal/fifo"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/pages"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
	"golang.org/x/sys/unix"
)

const (
	fifoPollMS   = 200
	bootIdleTick = 2 * time.Second
)

// Loop runs UART RX on its own goroutine and polls the command FIFO on the
// main goroutine. Splitting them avoids cases where FIFO/procd activity
// prevents UART reads even though the kernel rx counter is climbing.
func Loop(e *daemon.Engine, serial transport.PollableLineTransport, fifo *os.File, stop <-chan struct{}) error {
	if e == nil || serial == nil {
		return errors.New("missing engine or serial")
	}

	lines := make(chan string, 32)
	errc := make(chan error, 1)
	go readUART(e, serial, lines, errc, stop)

	var fifoBuf []byte
	if fifo != nil {
		fifoBuf = make([]byte, 0, 256)
	}
	bootTick := time.NewTicker(bootIdleTick)
	defer bootTick.Stop()
	idleBoot := 0

	for {
		if fifo != nil {
			pfds := []unix.PollFd{{Fd: int32(fifo.Fd()), Events: unix.POLLIN}}
			n, err := unix.Poll(pfds, fifoPollMS)
			if err != nil && err != unix.EINTR {
				return err
			}
			if n > 0 && pfds[0].Revents&(unix.POLLIN|unix.POLLERR|unix.POLLHUP) != 0 {
				if err := drainFIFO(e, fifo, &fifoBuf); err != nil {
					return err
				}
			}
		} else {
			select {
			case <-stop:
				return nil
			case <-time.After(time.Duration(fifoPollMS) * time.Millisecond):
			}
		}

		// Drain any UART lines already queued.
		for {
			select {
			case line := <-lines:
				_ = e.HandleRXLine(line)
			default:
				goto drained
			}
		}
	drained:

		select {
		case <-stop:
			return nil
		case err := <-errc:
			if err != nil && !errors.Is(err, io.EOF) {
				return err
			}
			return nil
		case <-bootTick.C:
			idleBoot++
			if idleBoot >= 1 && e.Nav.ActiveScreen == pages.BootScreen {
				idleBoot = 0
				_ = e.LeaveBoot()
			}
		default:
		}
	}
}

func readUART(e *daemon.Engine, serial transport.PollableLineTransport, lines chan<- string, errc chan<- error, stop <-chan struct{}) {
	defer close(lines)
	buf := make([]byte, 0, 512)
	for {
		select {
		case <-stop:
			return
		default:
		}

		b, err := serial.ReadByte()
		if err != nil {
			if errors.Is(err, os.ErrDeadlineExceeded) || errors.Is(err, unix.EAGAIN) {
				// Idle — wait for POLLIN on the UART fd.
				pfd := []unix.PollFd{{Fd: int32(serial.Fd()), Events: unix.POLLIN}}
				_, _ = unix.Poll(pfd, 500)
				continue
			}
			if errors.Is(err, unix.EIO) {
				if e.Log != nil {
					e.Log.Warnf("uart read: %v", err)
				}
				time.Sleep(50 * time.Millisecond)
				continue
			}
			errc <- err
			return
		}
		if b == '\n' || b == '\r' {
			if len(buf) == 0 {
				continue
			}
			line := string(buf)
			buf = buf[:0]
			select {
			case lines <- line:
			case <-stop:
				return
			}
			continue
		}
		if len(buf) >= int(e.Cfg.MaxLine) {
			buf = buf[:0]
			if e.Log != nil {
				e.Log.Warnf("line exceeded max_line=%d", e.Cfg.MaxLine)
			}
			continue
		}
		buf = append(buf, b)
	}
}

func drainFIFO(e *daemon.Engine, fifo *os.File, fifoBuf *[]byte) error {
	var chunk [64]byte
	for {
		nr, rerr := fifo.Read(chunk[:])
		if nr > 0 {
			for _, b := range chunk[:nr] {
				if b == '\n' || b == '\r' {
					if len(*fifoBuf) > 0 {
						line := string(*fifoBuf)
						*fifoBuf = (*fifoBuf)[:0]
						_ = e.HandleFIFO(line)
					}
					continue
				}
				if len(*fifoBuf) < cap(*fifoBuf)-1 {
					*fifoBuf = append(*fifoBuf, b)
				}
			}
		}
		if rerr != nil {
			if errors.Is(rerr, io.EOF) || errors.Is(rerr, unix.EAGAIN) {
				return nil
			}
			return rerr
		}
		if nr == 0 {
			return nil
		}
	}
}

// OpenFIFO opens the command FIFO reader.
func OpenFIFO() (*os.File, string, error) {
	path, f, err := fifopkg.OpenCommandReader()
	if err != nil {
		return nil, "", err
	}
	return f, path, nil
}
