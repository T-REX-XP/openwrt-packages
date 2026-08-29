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
	dbg    *syslog.Writer
}

func newLogger(cfg config.Config) stdLogger {
	w, err := syslog.New(syslog.LOG_DEBUG|syslog.LOG_DAEMON, "mcudd")
	if err != nil {
		return stdLogger{serial: cfg.DebugSerial}
	}
	return stdLogger{serial: cfg.DebugSerial, dbg: w}
}

func (l stdLogger) Infof(format string, args ...any) {
	fmt.Printf(format+"\n", args...)
}

func (l stdLogger) Warnf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
}

func (l stdLogger) Debugf(format string, args ...any) {
	if !l.serial || l.dbg == nil {
		return
	}
	_ = l.dbg.Debug(fmt.Sprintf(format, args...))
}
