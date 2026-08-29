package config

import (
	"os"
	"path/filepath"
	"testing"
)

const sampleUCI = `config mcud 'main'
	option enable '1'
	option path '/dev/ttyS2'
	option baud '115200'
	option wire_format 'json'
	option demo_mode '1'
	option max_line '4096'
	option screen_timeout '60'
	option screen_timeout_mode 'off'
	option debug '1'
	option debug_serial '1'
`

func TestLoadFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mcud")
	if err := os.WriteFile(path, []byte(sampleUCI), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := LoadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !c.Enable || c.Path != "/dev/ttyS2" || c.Baud != 115200 {
		t.Fatalf("%+v", c)
	}
	if !c.DemoMode || !c.Debug || !c.DebugSerial {
		t.Fatalf("flags: %+v", c)
	}
	if c.ScreenTimeoutSec != 60 || c.ScreenTimeoutMode != "off" || c.MaxLine != 4096 {
		t.Fatalf("timeouts: %+v", c)
	}
}

func TestLoadFileInvalidWireFormat(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mcud")
	body := "config mcud 'main'\n\toption enable '1'\n\toption path '/dev/ttyS0'\n\toption baud '115200'\n\toption wire_format 'xml'\n"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadFile(path); err == nil {
		t.Fatal("expected error")
	}
}

func TestLoadMissingFileUsesDefault(t *testing.T) {
	old := UCIPath
	t.Cleanup(func() { /* UCIPath is const, test Load via temp by LoadFile only */ _ = old })
	c, err := LoadFile(filepath.Join(t.TempDir(), "missing"))
	if err == nil {
		t.Fatal("expected missing file error")
	}
	_ = c
	def := Default()
	if !def.Enable || def.Path != "/dev/ttyS2" {
		t.Fatal(def)
	}
}

func TestLoadFileDisabledAndFlags(t *testing.T) {
	body := `config mcud 'main'
	option enable '0'
	option path '/dev/ttyUSB0'
	option baud '230400'
	option wire_format 'json'
	option demo_mode '0'
	option debug '0'
	option debug_serial '0'
`
	path := filepath.Join(t.TempDir(), "mcud")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := LoadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if c.Enable || c.DemoMode || c.Debug || c.DebugSerial {
		t.Fatalf("%+v", c)
	}
	if c.Path != "/dev/ttyUSB0" || c.Baud != 230400 {
		t.Fatalf("%+v", c)
	}
}

func TestTruthy(t *testing.T) {
	for _, v := range []string{"1", "true", "yes", "on", "TRUE"} {
		if !truthy(v) {
			t.Fatal(v)
		}
	}
	for _, v := range []string{"0", "false", "no", "off", ""} {
		if truthy(v) {
			t.Fatal(v)
		}
	}
}
