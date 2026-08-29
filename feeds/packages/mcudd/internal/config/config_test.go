package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sampleUCI = `config mcud 'main'
	option enable '1'
	option path '/dev/ttyS2'
	option baud '115200'
	option wire_format 'json'
	option demo_mode '1'
	option pages '/etc/mcud/pages.json'
	option wan_if 'wan'
	option lan_if 'br-lan'
	option wifi_if 'wlan0'
	option interval_system '1000'
	option interval_network '2000'
	option push_alerts '1'
	option max_line '4096'
	option screen_timeout '60'
	option screen_timeout_mode 'off'
	option log_level 'debug'
	option debug '1'
	option debug_serial '1'
	option menu_nav_button 'BTN_2'
	option menu_select_button 'wps'
	option menu_wps '0'
	option path_autodiscover '1'
`

func TestDefault(t *testing.T) {
	c := Default()
	if c.Path != "/dev/ttyS2" || c.Baud != 115200 || c.MaxLine != 4096 {
		t.Fatalf("%+v", c)
	}
	if c.WireFormat != WireJSON || c.WanIf != "wan" || c.IntervalSystemMs != 1000 {
		t.Fatalf("%+v", c)
	}
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestLoadUCIFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mcud")
	if err := os.WriteFile(path, []byte(sampleUCI), 0o644); err != nil {
		t.Fatal(err)
	}
	c, src, err := LoadPath(path)
	if err != nil {
		t.Fatal(err)
	}
	if src != path {
		t.Fatal(src)
	}
	if !c.Enable || c.Path != "/dev/ttyS2" || c.Baud != 115200 {
		t.Fatalf("%+v", c)
	}
	if !c.DemoMode || !c.Debug || !c.DebugSerial || !c.PushAlerts {
		t.Fatalf("flags: %+v", c)
	}
	if c.Pages != "/etc/mcud/pages.json" || c.LanIf != "br-lan" || c.WifiIf != "wlan0" {
		t.Fatalf("ifaces: %+v", c)
	}
	if c.ScreenTimeoutSec != 60 || c.LogLevel != LogDebug || c.MenuNavButton != "BTN_2" {
		t.Fatalf("%+v", c)
	}
}

func TestLoadFileInvalidWireFormat(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mcud")
	body := "config mcud 'main'\n\toption enable '1'\n\toption path '/dev/ttyS0'\n\toption baud '115200'\n\toption wire_format 'xml'\n"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadFile(path); err == nil {
		t.Fatal("expected error")
	}
}

func TestLoadMissingFile(t *testing.T) {
	_, err := LoadFile(filepath.Join(t.TempDir(), "missing"))
	if err == nil {
		t.Fatal("expected missing file error")
	}
}

func TestLoadPathEmptyDefaults(t *testing.T) {
	cfg, src, err := LoadPath("")
	if err != nil {
		t.Fatal(err)
	}
	if src != "(defaults)" && src != DefaultUCIPath {
		t.Log(src)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
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

func TestParseUCIOptionQuotedSpace(t *testing.T) {
	key, val, ok := parseUCIOption(`option pages '/etc/mcud/my pages.json'`)
	if !ok || key != "pages" || val != "/etc/mcud/my pages.json" {
		t.Fatalf("%q %q %v", key, val, ok)
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

func TestValidateAndDump(t *testing.T) {
	c := Default()
	c.WireFormat = "XML"
	normalize(&c)
	if err := c.Validate(); err == nil {
		t.Fatal("expected invalid wire")
	}
	c = Default()
	c.WireFormat = WireMsgPack
	if !c.MsgPackUnsupported() {
		t.Fatal("msgpack")
	}
	s := c.Dump()
	if !strings.Contains(s, "wire_format=msgpack") || !strings.Contains(s, "path=") {
		t.Fatal(s)
	}
	if !strings.Contains(c.Summary(), "wire=msgpack") {
		t.Fatal(c.Summary())
	}
}

func TestValidateBadModes(t *testing.T) {
	c := Default()
	c.Path = ""
	if err := c.Validate(); err == nil {
		t.Fatal("empty path")
	}
	c = Default()
	c.Baud = 0
	if err := c.Validate(); err == nil {
		t.Fatal("baud")
	}
	c = Default()
	c.MaxLine = 8
	if err := c.Validate(); err == nil {
		t.Fatal("max_line")
	}
	c = Default()
	c.ScreenTimeoutMode = "sleep"
	if err := c.Validate(); err == nil {
		t.Fatal("mode")
	}
	c = Default()
	c.IntervalNetworkMs = 0
	if err := c.Validate(); err == nil {
		t.Fatal("interval")
	}
}

func TestLoadUCIUnquotedAndComments(t *testing.T) {
	body := `# comment
config mcud 'main'
	option enable 1
	option path /dev/ttyS1
	option baud 57600
	option wire_format json
	option max_line 1024
	option screen_timeout_mode blank
	option log_level warn
	option interval_system 250
	option interval_network 500
	option path_autodiscover 0
	option push_alerts 0
	option menu_wps 1
	option wan_if eth0
	option lan_if br-lan
	option wifi_if wlan0
	option pages /etc/mcud/pages.json
	option menu_nav_button BTN_1
	option menu_select_button wps
`
	path := filepath.Join(t.TempDir(), "mcud")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := LoadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !c.Enable || c.Path != "/dev/ttyS1" || c.Baud != 57600 {
		t.Fatalf("%+v", c)
	}
	if c.PathAutodiscover || c.PushAlerts || !c.MenuWPS {
		t.Fatalf("flags %+v", c)
	}
	if c.WanIf != "eth0" || c.MenuNavButton != "BTN_1" || c.MaxLine != 1024 {
		t.Fatalf("%+v", c)
	}
}

func TestRejectJSONConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(path, []byte(`{"path":"/dev/ttyS2"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadPath(path); err == nil {
		t.Fatal("expected reject JSON")
	}
}

func TestLoadUsesLoadHelper(t *testing.T) {
	_ = Load()
}

func TestLoadInvalidEmptyPath(t *testing.T) {
	prev := emptyPath
	t.Cleanup(func() { emptyPath = prev })
	path := filepath.Join(t.TempDir(), "bad")
	if err := os.WriteFile(path, []byte(`{"path":"/dev/ttyS2"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	emptyPath = path
	cfg := Load()
	if cfg.Path != Default().Path {
		t.Fatalf("%+v", cfg)
	}
	if _, _, err := LoadPath(""); err == nil {
		t.Fatal("expected invalid empty path")
	}
}

func TestParseUCIScannerTooLong(t *testing.T) {
	body := "option path '" + strings.Repeat("x", 70_000) + "'\n"
	if _, err := parseUCI(body); err == nil {
		t.Fatal("expected scanner error")
	}
	path := filepath.Join(t.TempDir(), "huge")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadPath(path); err == nil {
		t.Fatal("expected LoadPath scanner error")
	}
}

func TestParseUCISkipsBadOption(t *testing.T) {
	body := `config mcud 'main'
	option key
	option path '/dev/ttyS2'
	option baud '115200'
	option wire_format 'json'
`
	path := filepath.Join(t.TempDir(), "mcud")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := LoadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if c.Path != "/dev/ttyS2" {
		t.Fatalf("%+v", c)
	}
}

func TestParseUCIOptionBarePrefix(t *testing.T) {
	if _, _, ok := parseUCIOption("option "); ok {
		t.Fatal("expected fail")
	}
}

func TestParseUCIOptionBad(t *testing.T) {
	if _, _, ok := parseUCIOption("option"); ok {
		t.Fatal("expected fail")
	}
	if _, _, ok := parseUCIOption("option key"); ok {
		t.Fatal("expected fail")
	}
	if _, _, ok := parseUCIOption("option key 'unclosed"); ok {
		t.Fatal("expected fail")
	}
}

func TestDebugPromotesLogLevel(t *testing.T) {
	c := Default()
	c.Debug = true
	c.LogLevel = LogInfo
	normalize(&c)
	if c.LogLevel != LogDebug {
		t.Fatal(c.LogLevel)
	}
}

func TestApplyOptionsIgnoresBadNumbers(t *testing.T) {
	body := `config mcud 'main'
	option enable '1'
	option path '/dev/ttyS2'
	option baud 'abc'
	option max_line '10'
	option interval_system '0'
	option interval_network '-1'
	option screen_timeout '-3'
	option wire_format ''
	option pages ''
	option wan_if ''
	option lan_if ''
	option wifi_if ''
	option log_level ''
	option menu_nav_button ''
	option menu_select_button ''
	option screen_timeout_mode ''
`
	path := filepath.Join(t.TempDir(), "mcud")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := LoadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	d := Default()
	if c.Baud != d.Baud || c.MaxLine != d.MaxLine {
		t.Fatalf("%+v", c)
	}
}

func TestParseUCIOptionEmptyAndDoubleQuote(t *testing.T) {
	if _, _, ok := parseUCIOption("option key "); ok {
		t.Fatal("empty value")
	}
	key, val, ok := parseUCIOption(`option path "/dev/ttyUSB0"`)
	if !ok || key != "path" || val != "/dev/ttyUSB0" {
		t.Fatalf("%q %q %v", key, val, ok)
	}
}

func TestValidateBadLogLevel(t *testing.T) {
	c := Default()
	c.LogLevel = "trace"
	if err := c.Validate(); err == nil {
		t.Fatal("expected error")
	}
}
