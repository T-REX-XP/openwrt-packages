//go:build linux

package main

import (
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
)

func transportOpenSerial(path string, baud int) (transport.LineTransport, error) {
	return transport.OpenSerial(path, baud)
}
