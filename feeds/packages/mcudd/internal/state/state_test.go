package state

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/rdcp"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/version"
)

func TestStateFiles(t *testing.T) {
	dir := t.TempDir()
	w := Writer{Dir: dir}
	if err := w.WriteActiveScreen("router_system"); err != nil {
		t.Fatal(err)
	}
	msg := rdcp.Message{
		VersionStack:     version.Stack,
		VersionRelease:   version.Release,
		VersionRDCP:      version.RDCP,
		VersionComponent: version.ComponentFW,
	}
	if err := w.WriteFirmwareVersion(msg); err != nil {
		t.Fatal(err)
	}
	if err := w.WriteLinkTest(LinkTest{PingOK: true, PingID: 1, EchoOK: true, EchoText: `a"b`}); err != nil {
		t.Fatal(err)
	}
	if err := w.WriteActiveScreen(""); err != nil {
		t.Fatal(err)
	}
}

func TestReadBootState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state")
	_ = os.WriteFile(path, []byte("stage=ready\nmessage=OK\npct=100\n"), 0o644)
	bs := ReadBootState(path)
	if !bs.Ready() || bs.Message != "OK" || bs.Pct != 100 {
		t.Fatalf("%+v", bs)
	}
	def := ReadBootState(filepath.Join(t.TempDir(), "missing"))
	if def.Stage != "boot" {
		t.Fatal(def)
	}
}

func TestWriterDefaultPath(t *testing.T) {
	w := Writer{}
	if err := w.WriteActiveScreen("router_system"); err != nil {
		t.Fatal(err)
	}
}

func TestReadBootStatePctClamp(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state")
	_ = os.WriteFile(path, []byte("stage=x\npct=-5\n"), 0o644)
	bs := ReadBootState(path)
	if bs.Pct != 0 {
		t.Fatalf("pct=%d", bs.Pct)
	}
	_ = os.WriteFile(path, []byte("pct=200\n"), 0o644)
	bs = ReadBootState(path)
	if bs.Pct != 100 {
		t.Fatalf("pct=%d", bs.Pct)
	}
}
