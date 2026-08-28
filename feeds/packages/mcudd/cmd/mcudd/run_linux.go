//go:build linux

package main

import (
	"os"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/daemon"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/run"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
)

func transportOpenSerial(path string, baud int) (transport.LineTransport, error) {
	return transport.OpenSerial(path, baud)
}

func acquireLock() (func(), error) {
	return run.AcquireLock()
}

func openFIFO() (*os.File, string, error) {
	return run.OpenFIFO()
}

func runPollLoop(e *daemon.Engine, tp transport.LineTransport, fifo *os.File, stop <-chan struct{}) error {
	serial, ok := tp.(transport.PollableLineTransport)
	if !ok {
		return runLoopUnsupported()
	}
	return run.Loop(e, serial, fifo, stop)
}

func runLoopUnsupported() error {
	return os.ErrInvalid
}
