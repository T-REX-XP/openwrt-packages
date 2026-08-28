//go:build !linux

package main

import (
	"fmt"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
)

func transportOpenSerial(path string, baud int) (transport.LineTransport, error) {
	if path == "" {
		return nil, fmt.Errorf("serial requires linux (set MCUDD_MOCK=1 for mock)")
	}
	return nil, fmt.Errorf("serial transport requires linux (set MCUDD_MOCK=1)")
}
