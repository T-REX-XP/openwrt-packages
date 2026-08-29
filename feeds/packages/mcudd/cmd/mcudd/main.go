package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/config"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/daemon"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/pages"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/version"
)

func main() {
	var (
		showVersion     bool
		showVersionJSON bool
		dumpConfig      bool
		configPath      string
	)
	flag.BoolVar(&showVersion, "version", false, "print version")
	flag.BoolVar(&showVersion, "V", false, "print version")
	flag.BoolVar(&showVersionJSON, "version-json", false, "print host version as JSON")
	flag.BoolVar(&dumpConfig, "dump-config", false, "print effective config and exit")
	flag.StringVar(&configPath, "config", "", "UCI config path (default /etc/config/mcud)")
	flag.Parse()

	if showVersionJSON {
		fmt.Println(version.JSON())
		return
	}
	if showVersion {
		fmt.Printf("%s rdcp=%d pages_schema=%d component=%s\n",
			version.String(), version.RDCP, version.PagesSchema, version.ComponentHost)
		return
	}

	cfg, src, err := config.LoadPath(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mcudd: config: %v\n", err)
		os.Exit(1)
	}

	if dumpConfig {
		fmt.Printf("# source: %s\n%s", src, cfg.Dump())
		return
	}

	if err := runDaemon(cfg, src); err != nil {
		fmt.Fprintf(os.Stderr, "mcudd: %v\n", err)
		os.Exit(1)
	}
}

func runDaemon(cfg config.Config, configSrc string) error {
	release, err := acquireLock()
	if err != nil {
		return err
	}
	defer release()

	if !cfg.Enable {
		fmt.Printf("disabled in config (%s)\n", configSrc)
		return nil
	}
	if cfg.MsgPackUnsupported() {
		fmt.Fprintf(os.Stderr, "warn: wire_format=msgpack not supported yet; using JSON framing\n")
		cfg.WireFormat = config.WireJSON
	}

	tp, err := openTransport(cfg)
	if err != nil {
		return err
	}
	defer tp.Close()

	log := newLogger(cfg)
	fmt.Printf("config %s\n", configSrc)
	fmt.Printf("%s\n", cfg.Summary())
	fmt.Printf("UART open on %s\n", cfg.Path)

	engine := daemon.New(cfg, tp)
	engine.Log = log
	_ = engine.State.WriteActiveScreen(pages.BootScreen)

	if err := engine.Startup(); err != nil {
		return fmt.Errorf("startup: %w", err)
	}

	fifo, fifoPath, err := openFIFO()
	if err != nil {
		fmt.Fprintf(os.Stderr, "warn: fifo unavailable: %v\n", err)
	} else {
		defer fifo.Close()
		fmt.Printf("command FIFO %s\n", fifoPath)
	}

	stop := make(chan struct{})
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sig
		close(stop)
	}()

	if buf, ok := tp.(*transport.Buffer); ok {
		return runMockLoop(engine, buf, fifo, stop)
	}
	return runPollLoop(engine, tp, fifo, stop)
}

func openTransport(cfg config.Config) (transport.LineTransport, error) {
	if os.Getenv("MCUDD_MOCK") == "1" {
		return &transport.Buffer{}, nil
	}
	return transportOpenSerial(cfg.Path, cfg.Baud)
}
