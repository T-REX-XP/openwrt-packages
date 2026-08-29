//go:build !linux

package main

import (
	"errors"
	"os"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/engine"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
)

func transportOpenSerial(path string, baud int) (transport.LineTransport, error) {
	if os.Getenv("MCUDD_MOCK") == "1" {
		return &transport.Buffer{}, nil
	}
	return nil, errors.New("serial transport requires linux (set MCUDD_MOCK=1)")
}

func acquireLock() (func(), error) {
	return func() {}, nil
}

func openFIFO() (*os.File, string, error) {
	return nil, "", errors.New("fifo requires linux")
}

func runPollLoop(e *engine.Engine, tp transport.LineTransport, fifo *os.File, stop <-chan struct{}) error {
	return errors.New("poll loop requires linux")
}

func runMockLoop(e *engine.Engine, buf *transport.Buffer, fifo *os.File, stop <-chan struct{}) error {
	for {
		select {
		case <-stop:
			return nil
		default:
			if !buf.HasRX() {
				continue
			}
			_ = e.PollOnce()
		}
	}
}
