//go:build linux

package run

import (
	"errors"
	"io"
	"os"
	"syscall"
	"time"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/daemon"
	fifopkg "github.com/t-rex-xp/openwrt-packages/mcudd/internal/fifo"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/pages"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
)

const pollTimeoutMS = 500

// Loop runs the UART + FIFO poll loop until stop is closed or an error occurs.
func Loop(e *daemon.Engine, serial transport.PollableLineTransport, fifo *os.File, stop <-chan struct{}) error {
	if e == nil || serial == nil {
		return errors.New("missing engine or serial")
	}

	pfds := []syscall.PollFd{{Fd: int32(serial.Fd()), Events: syscall.POLLIN}}
	fifoIdx := -1
	if fifo != nil {
		fifoIdx = len(pfds)
		pfds = append(pfds, syscall.PollFd{Fd: int32(fifo.Fd()), Events: syscall.POLLIN})
	}

	fifoBuf := make([]byte, 0, 256)
	idlePolls := 0

	for {
		select {
		case <-stop:
			return nil
		default:
		}

		n, err := syscall.Poll(pfds, pollTimeoutMS)
		if err != nil {
			if err == syscall.EINTR {
				continue
			}
			return err
		}
		if n == 0 {
			idlePolls++
			if idlePolls >= 4 && e.Nav.ActiveScreen == pages.BootScreen {
				idlePolls = 0
				_ = e.LeaveBoot()
			}
			continue
		}
		idlePolls = 0

		if fifoIdx >= 0 && pfds[fifoIdx].Revents&syscall.POLLIN != 0 {
			var chunk [64]byte
			for {
				nr, rerr := fifo.Read(chunk[:])
				if nr > 0 {
					for _, b := range chunk[:nr] {
						if b == '\n' || b == '\r' {
							if len(fifoBuf) > 0 {
								line := string(fifoBuf)
								fifoBuf = fifoBuf[:0]
								_ = e.HandleFIFO(line)
							}
							continue
						}
						if len(fifoBuf) < cap(fifoBuf)-1 {
							fifoBuf = append(fifoBuf, b)
						}
					}
				}
				if rerr != nil {
					if errors.Is(rerr, io.EOF) || errors.Is(rerr, syscall.EAGAIN) {
						break
					}
					return rerr
				}
				if nr == 0 {
					break
				}
			}
		}

		if pfds[0].Revents&syscall.POLLIN != 0 {
			for i := 0; i < 32; i++ {
				if err := e.PollOnce(); err != nil {
					if errors.Is(err, io.EOF) || errors.Is(err, os.ErrDeadlineExceeded) {
						break
					}
					return err
				}
				time.Sleep(time.Millisecond)
			}
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
