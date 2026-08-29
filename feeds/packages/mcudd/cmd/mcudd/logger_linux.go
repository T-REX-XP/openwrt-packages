//go:build linux

package main

import (
	"fmt"
	"log/syslog"
	"os"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/config"
)

type stdLogger struct {
	serial bool
	w      *syslog.Writer
}

func newLogger(cfg config.Config) stdLogger {
	w, err := syslog.New(syslog.LOG_INFO|syslog.LOG_DAEMON, "mcudd")
	if err != nil {
		// Fall back to stderr only — never block the UART loop on a full stdout pipe.
		return stdLogger{serial: cfg.DebugSerial}
	}
	return stdLogger{serial: cfg.DebugSerial, w: w}
}

func (l stdLogger) Infof(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	if l.w != nil {
		_ = l.w.Info(msg)
		return
	}
	fmt.Fprintln(os.Stderr, msg)
}

func (l stdLogger) Warnf(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	if l.w != nil {
		_ = l.w.Warning(msg)
		return
	}
	fmt.Fprintln(os.Stderr, msg)
}

func (l stdLogger) Debugf(format string, args ...any) {
	if !l.serial {
		return
	}
	msg := fmt.Sprintf(format, args...)
	if l.w != nil {
		_ = l.w.Debug(msg)
		return
	}
	fmt.Fprintln(os.Stderr, msg)
}
