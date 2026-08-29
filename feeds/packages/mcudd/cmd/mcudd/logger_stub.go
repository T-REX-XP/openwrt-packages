//go:build !linux

package main

import (
	"fmt"
	"os"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/config"
)

type stdLogger struct {
	serial bool
}

func newLogger(cfg config.Config) stdLogger {
	return stdLogger{serial: cfg.DebugSerial}
}

func (l stdLogger) Infof(format string, args ...any)  { fmt.Printf(format+"\n", args...) }
func (l stdLogger) Warnf(format string, args ...any)  { fmt.Fprintf(os.Stderr, format+"\n", args...) }
func (l stdLogger) Debugf(format string, args ...any) {
	if l.serial {
		fmt.Printf("debug: "+format+"\n", args...)
	}
}
