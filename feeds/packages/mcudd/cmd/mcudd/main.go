package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/config"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/daemon"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/version"
)

func main() {
	var showVersion bool
	flag.BoolVar(&showVersion, "version", false, "print version")
	flag.BoolVar(&showVersion, "V", false, "print version")
	flag.Parse()

	if showVersion {
		fmt.Printf("%s rdcp=%d pages_schema=%d component=%s\n",
			version.String(), version.RDCP, version.PagesSchema, version.ComponentHost)
		return
	}

	cfg := config.Default()
	if !cfg.Enable {
		return
	}

	tp, err := openTransport(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "transport: %v\n", err)
		os.Exit(1)
	}
	defer tp.Close()

	engine := daemon.New(cfg, tp)
	engine.Log = stdLogger{}
	if err := engine.Startup(); err != nil {
		fmt.Fprintf(os.Stderr, "startup: %v\n", err)
		os.Exit(1)
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)

	for {
		select {
		case <-sig:
			return
		default:
			if buf, ok := tp.(*transport.Buffer); ok {
				if !buf.HasRX() {
					continue
				}
			}
			if err := engine.PollOnce(); err != nil {
				continue
			}
		}
	}
}

type stdLogger struct{}

func (stdLogger) Infof(format string, args ...any)  { fmt.Printf("info: "+format+"\n", args...) }
func (stdLogger) Warnf(format string, args ...any)  { fmt.Fprintf(os.Stderr, "warn: "+format+"\n", args...) }
func (stdLogger) Debugf(format string, args ...any) {}

func openTransport(cfg config.Config) (transport.LineTransport, error) {
	if os.Getenv("MCUDD_MOCK") == "1" {
		return &transport.Buffer{}, nil
	}
	return transportOpenSerial(cfg.Path, cfg.Baud)
}
