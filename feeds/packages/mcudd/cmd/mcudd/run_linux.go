//go:build linux

package main

import (
	"os"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/engine"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/fifo"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
)

func transportOpenSerial(path string, baud int) (transport.LineTransport, error) {
	return transport.OpenSerial(path, baud)
}

func acquireLock() (func(), error) {
	return acquireInstanceLock()
}

func openFIFO() (*os.File, string, error) {
	path, f, err := fifo.OpenCommandReader()
	return f, path, err
}

func runPollLoop(e *engine.Engine, tp transport.LineTransport, fifoFile *os.File, stop <-chan struct{}) error {
	serial, ok := tp.(transport.PollableLineTransport)
	if !ok {
		return os.ErrInvalid
	}
	return pollLoop(e, serial, fifoFile, stop)
}
