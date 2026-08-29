package config

import "fmt"

// Wire / log level constants (UCI + JSON).
const (
	WireJSON    = "json"
	WireMsgPack = "msgpack"

	LogError = "error"
	LogWarn  = "warn"
	LogInfo  = "info"
	LogDebug = "debug"

	// DefaultUCIPath is the OpenWrt UCI file shipped with luci-app-mcu-display.
	DefaultUCIPath = "/etc/config/mcud"
)

// Config holds all runtime settings for mcudd (UART, wire format, metrics, logging).
type Config struct {
	Enable bool `json:"enable"`

	// UART
	Path             string `json:"path"`
	Baud             int    `json:"baud"`
	PathAutodiscover bool   `json:"path_autodiscover"`

	// Protocol
	WireFormat string `json:"wire_format"` // json | msgpack
	MaxLine    uint   `json:"max_line"`
	Pages      string `json:"pages"`

	// Display / boot
	DemoMode           bool   `json:"demo_mode"`
	ScreenTimeoutSec   uint   `json:"screen_timeout"`
	ScreenTimeoutMode  string `json:"screen_timeout_mode"` // off | dim | blank
	PushAlerts         bool   `json:"push_alerts"`

	// Metrics interfaces / intervals (ms)
	WanIf              string `json:"wan_if"`
	LanIf              string `json:"lan_if"`
	WifiIf             string `json:"wifi_if"`
	IntervalSystemMs   uint   `json:"interval_system"`
	IntervalNetworkMs  uint   `json:"interval_network"`

	// Logging
	LogLevel    string `json:"log_level"` // error|warn|info|debug
	Debug       bool   `json:"debug"`
	DebugSerial bool   `json:"debug_serial"`

	// Button mapping (consumed by hotplug/LuCI; stored for parity)
	MenuNavButton    string `json:"menu_nav_button"`
	MenuSelectButton string `json:"menu_select_button"`
	MenuWPS          bool   `json:"menu_wps"`
}

// Default returns CM5-oriented defaults used when a file is missing or an option is omitted.
func Default() Config {
	return Config{
		Enable:             true,
		Path:               "/dev/ttyS2",
		Baud:               115200,
		PathAutodiscover:   true,
		WireFormat:         WireJSON,
		MaxLine:            4096,
		Pages:              "/etc/mcud/pages.json",
		DemoMode:           false,
		ScreenTimeoutSec:   60,
		ScreenTimeoutMode:  "off",
		PushAlerts:         true,
		WanIf:              "wan",
		LanIf:              "br-lan",
		WifiIf:             "wlan0",
		IntervalSystemMs:   1000,
		IntervalNetworkMs:  2000,
		LogLevel:           LogInfo,
		Debug:              false,
		DebugSerial:        false,
		MenuNavButton:      "BTN_2",
		MenuSelectButton:   "wps",
		MenuWPS:            false,
	}
}

// Validate checks required fields and enum values.
func (c Config) Validate() error {
	if c.Path == "" {
		return fmt.Errorf("path is required")
	}
	if c.Baud <= 0 {
		return fmt.Errorf("invalid baud %d", c.Baud)
	}
	switch c.WireFormat {
	case WireJSON, WireMsgPack:
	default:
		return fmt.Errorf("invalid wire_format %q (want json|msgpack)", c.WireFormat)
	}
	if c.MaxLine < 64 {
		return fmt.Errorf("max_line must be >= 64")
	}
	switch c.ScreenTimeoutMode {
	case "off", "dim", "blank":
	default:
		return fmt.Errorf("invalid screen_timeout_mode %q", c.ScreenTimeoutMode)
	}
	switch c.LogLevel {
	case LogError, LogWarn, LogInfo, LogDebug:
	default:
		return fmt.Errorf("invalid log_level %q", c.LogLevel)
	}
	if c.IntervalSystemMs == 0 || c.IntervalNetworkMs == 0 {
		return fmt.Errorf("metric intervals must be > 0")
	}
	return nil
}

// MsgPackUnsupported reports whether wire_format is msgpack (not implemented yet).
func (c Config) MsgPackUnsupported() bool {
	return c.WireFormat == WireMsgPack
}

// Summary returns a one-line startup description.
func (c Config) Summary() string {
	return fmt.Sprintf("path=%s baud=%d wire=%s max_line=%d demo=%t debug_serial=%t",
		c.Path, c.Baud, c.WireFormat, c.MaxLine, c.DemoMode, c.DebugSerial)
}

// Dump returns a multi-line human-readable config dump.
func (c Config) Dump() string {
	return fmt.Sprintf(`enable=%t
path=%s
baud=%d
path_autodiscover=%t
wire_format=%s
max_line=%d
pages=%s
demo_mode=%t
screen_timeout=%d
screen_timeout_mode=%s
push_alerts=%t
wan_if=%s
lan_if=%s
wifi_if=%s
interval_system=%d
interval_network=%d
log_level=%s
debug=%t
debug_serial=%t
menu_nav_button=%s
menu_select_button=%s
menu_wps=%t
`,
		c.Enable, c.Path, c.Baud, c.PathAutodiscover, c.WireFormat, c.MaxLine, c.Pages,
		c.DemoMode, c.ScreenTimeoutSec, c.ScreenTimeoutMode, c.PushAlerts,
		c.WanIf, c.LanIf, c.WifiIf, c.IntervalSystemMs, c.IntervalNetworkMs,
		c.LogLevel, c.Debug, c.DebugSerial,
		c.MenuNavButton, c.MenuSelectButton, c.MenuWPS,
	)
}
