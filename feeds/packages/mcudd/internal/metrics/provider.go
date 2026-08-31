package metrics

import (
	"context"
	"io"
	"net/http"
	"os"
	"os/exec"
	"syscall"
	"time"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/config"
)

// Disk is a portable view of syscall.Statfs.
type Disk struct {
	Blocks uint64
	Bavail uint64
	Bsize  uint64
}

// Sys is the host surface collectors read. Tests inject fakes.
type Sys struct {
	ReadFile  func(string) ([]byte, error)
	ReadDir   func(string) ([]os.DirEntry, error)
	Statfs    func(string) (Disk, error)
	Run       func(name string, args ...string) ([]byte, error)
	HTTPGet   func(url string) ([]byte, error)
	Now       func() time.Time
	Hostname  func() (string, error)
}

// Provider returns JSON object payloads for RDCP metric scopes.
type Provider struct {
	DemoMode bool
	WanIf    string
	LanIf    string
	WifiIf   string
	Sys      Sys

	prevCPUIdle  uint64
	prevCPUTotal uint64
	prevCPUOK    bool
	prevNetRX    uint64
	prevNetTX    uint64
	prevNetDev   string
	prevNetAt    time.Time
}

func New(cfg config.Config) *Provider {
	wan, lan, wifi := cfg.WanIf, cfg.LanIf, cfg.WifiIf
	if wan == "" {
		wan = "wan"
	}
	if lan == "" {
		lan = "br-lan"
	}
	if wifi == "" {
		wifi = "wlan0"
	}
	return &Provider{
		DemoMode: cfg.DemoMode,
		WanIf:    wan,
		LanIf:    lan,
		WifiIf:   wifi,
		Sys:      defaultSys(),
	}
}

func defaultSys() Sys {
	return Sys{
		ReadFile: os.ReadFile,
		ReadDir:  os.ReadDir,
		Statfs:   defaultStatfs,
		Run:      defaultRun,
		HTTPGet:  defaultHTTPGet,
		Now:      time.Now,
		Hostname: os.Hostname,
	}
}

func defaultStatfs(path string) (Disk, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return Disk{}, err
	}
	return Disk{
		Blocks: uint64(st.Blocks),
		Bavail: uint64(st.Bavail),
		Bsize:  uint64(st.Bsize),
	}, nil
}

func defaultRun(name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancel()
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

func defaultHTTPGet(url string) ([]byte, error) {
	c := &http.Client{Timeout: 400 * time.Millisecond}
	resp, err := c.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(io.LimitReader(resp.Body, 64*1024))
}

func (p *Provider) readFile(path string) []byte {
	if p.Sys.ReadFile == nil {
		return nil
	}
	b, err := p.Sys.ReadFile(path)
	if err != nil {
		return nil
	}
	return b
}

func (p *Provider) readDir(path string) []os.DirEntry {
	if p.Sys.ReadDir == nil {
		return nil
	}
	ents, err := p.Sys.ReadDir(path)
	if err != nil {
		return nil
	}
	return ents
}

func (p *Provider) statfs(path string) (Disk, bool) {
	if p.Sys.Statfs == nil {
		return Disk{}, false
	}
	d, err := p.Sys.Statfs(path)
	if err != nil || d.Blocks == 0 || d.Bsize == 0 {
		return Disk{}, false
	}
	return d, true
}

func (p *Provider) run(name string, args ...string) []byte {
	if p.Sys.Run == nil {
		return nil
	}
	b, _ := p.Sys.Run(name, args...)
	return b
}

func (p *Provider) httpGet(url string) []byte {
	if p.Sys.HTTPGet == nil {
		return nil
	}
	b, err := p.Sys.HTTPGet(url)
	if err != nil {
		return nil
	}
	return b
}

func (p *Provider) now() time.Time {
	if p.Sys.Now != nil {
		return p.Sys.Now()
	}
	return time.Now()
}

func (p *Provider) hostname() string {
	if p.Sys.Hostname != nil {
		if h, err := p.Sys.Hostname(); err == nil && h != "" {
			return h
		}
	}
	b := p.readFile("/proc/sys/kernel/hostname")
	if s := trimNL(string(b)); s != "" {
		return s
	}
	return "Router"
}
