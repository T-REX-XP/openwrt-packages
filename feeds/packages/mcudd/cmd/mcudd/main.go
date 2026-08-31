package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/config"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/engine"
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
	log.Infof("config %s", configSrc)
	log.Infof("%s", cfg.Summary())
	log.Infof("UART open on %s", cfg.Path)

	if err := pages.LoadFile(cfg.Pages); err != nil {
		log.Warnf("pages %s: %v (using built-in ring)", cfg.Pages, err)
		pages.ResetDefault()
	}

	eng := engine.New(cfg, tp)
	eng.Log = log
	_ = eng.State.WriteActiveScreen(pages.BootScreen)

	fifo, fifoPath, err := openFIFO()
	if err != nil {
		log.Warnf("fifo unavailable: %v", err)
	} else {
		defer fifo.Close()
		log.Infof("command FIFO %s", fifoPath)
	}

	stop := make(chan struct{})
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sig
		close(stop)
	}()

	if buf, ok := tp.(*transport.Buffer); ok {
		if err := eng.Startup(); err != nil {
			return fmt.Errorf("startup: %w", err)
		}
		return runMockLoop(eng, buf, fifo, stop)
	}
	return runPollLoop(eng, tp, fifo, stop)
}

func openTransport(cfg config.Config) (transport.LineTransport, error) {
	if os.Getenv("MCUDD_MOCK") == "1" {
		return &transport.Buffer{}, nil
	}
	return transportOpenSerial(cfg.Path, cfg.Baud)
}
