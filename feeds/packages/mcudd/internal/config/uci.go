package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

const UCIPath = "/etc/config/mcud"

// Load reads /etc/config/mcud or returns Default on missing/invalid file.
func Load() Config {
	cfg, err := LoadFile(UCIPath)
	if err != nil {
		return Default()
	}
	return cfg
}

// LoadFile parses OpenWrt UCI mcud options (first config mcud section).
func LoadFile(path string) (Config, error) {
	f, err := os.Open(path)
	if err != nil {
		return Config{}, err
	}
	defer f.Close()

	opts := map[string]string{}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "option ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		key := fields[1]
		val := strings.Trim(fields[2], `'"`)
		opts[key] = val
	}
	if err := scanner.Err(); err != nil {
		return Config{}, err
	}

	c := Default()
	if v, ok := opts["enable"]; ok {
		c.Enable = truthy(v)
	}
	if v, ok := opts["path"]; ok && v != "" {
		c.Path = v
	}
	if v, ok := opts["baud"]; ok {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return Config{}, fmt.Errorf("invalid baud")
		}
		c.Baud = n
	}
	if v, ok := opts["wire_format"]; ok && v != "" {
		if v != "json" && v != "msgpack" {
			return Config{}, fmt.Errorf("invalid wire_format")
		}
		c.WireFormat = v
	}
	if v, ok := opts["demo_mode"]; ok {
		c.DemoMode = truthy(v)
	}
	if v, ok := opts["max_line"]; ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < 64 {
			return Config{}, fmt.Errorf("invalid max_line")
		}
		c.MaxLine = uint(n)
	}
	if v, ok := opts["screen_timeout"]; ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return Config{}, fmt.Errorf("invalid screen_timeout")
		}
		c.ScreenTimeoutSec = uint(n)
	}
	if v, ok := opts["screen_timeout_mode"]; ok && v != "" {
		switch v {
		case "off", "dim", "blank":
			c.ScreenTimeoutMode = v
		default:
			return Config{}, fmt.Errorf("invalid screen_timeout_mode")
		}
	}
	if v, ok := opts["debug"]; ok {
		c.Debug = truthy(v)
	}
	if v, ok := opts["debug_serial"]; ok {
		c.DebugSerial = truthy(v)
	}
	return c, nil
}

func truthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
