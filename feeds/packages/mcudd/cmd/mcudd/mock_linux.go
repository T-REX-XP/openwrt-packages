//go:build linux

package main

import (
	"os"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/engine"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
)

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
