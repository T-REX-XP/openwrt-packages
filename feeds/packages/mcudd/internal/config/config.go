package config

type Config struct {
	Enable             bool
	Path               string
	Baud               int
	WireFormat         string
	DemoMode           bool
	ScreenTimeoutSec   uint
	ScreenTimeoutMode  string
	MaxLine            uint
	Debug              bool
	DebugSerial        bool
}

func Default() Config {
	return Config{
		Enable:            true,
		Path:              "/dev/ttyS2",
		Baud:              115200,
		WireFormat:        "json",
		ScreenTimeoutSec:  0,
		ScreenTimeoutMode: "off",
		MaxLine:           4096,
	}
}
