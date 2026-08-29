package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Load reads /etc/config/mcud, or returns Default() if the file is missing/invalid.
func Load() Config {
	cfg, _, err := LoadPath("")
	if err != nil {
		return Default()
	}
	return cfg
}

// LoadPath loads an OpenWrt UCI mcud file.
// Empty path uses DefaultUCIPath (/etc/config/mcud); if missing, returns Default().
func LoadPath(path string) (Config, string, error) {
	if path == "" {
		path = DefaultUCIPath
		if _, err := os.Stat(path); err != nil {
			return Default(), "(defaults)", nil
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, "", err
	}
	content := string(data)
	if strings.HasPrefix(strings.TrimSpace(content), "{") {
		return Config{}, path, fmt.Errorf("expected OpenWrt UCI config, got JSON")
	}

	cfg, err := parseUCI(content)
	if err != nil {
		return Config{}, path, err
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, path, err
	}
	return cfg, path, nil
}

func parseUCI(content string) (Config, error) {
	opts := map[string]string{}
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if !strings.HasPrefix(line, "option ") {
			continue
		}
		key, val, ok := parseUCIOption(line)
		if !ok {
			continue
		}
		opts[key] = val
	}
	if err := scanner.Err(); err != nil {
		return Config{}, err
	}

	c := Default()
	applyOptions(&c, opts)
	normalize(&c)
	return c, nil
}

// parseUCIOption parses: option key 'value' | option key "value" | option key value
func parseUCIOption(line string) (key, val string, ok bool) {
	rest := strings.TrimSpace(strings.TrimPrefix(line, "option "))
	if rest == "" {
		return "", "", false
	}
	sp := strings.IndexByte(rest, ' ')
	if sp < 0 {
		return "", "", false
	}
	key = rest[:sp]
	raw := strings.TrimSpace(rest[sp+1:])
	if raw == "" {
		return "", "", false
	}
	switch raw[0] {
	case '\'', '"':
		q := raw[0]
		end := strings.IndexByte(raw[1:], q)
		if end < 0 {
			return "", "", false
		}
		return key, raw[1 : 1+end], true
	default:
		return key, strings.Fields(raw)[0], true
	}
}

func applyOptions(c *Config, opts map[string]string) {
	if v, ok := opts["enable"]; ok {
		c.Enable = truthy(v)
	}
	if v, ok := opts["path"]; ok && v != "" {
		c.Path = v
	}
	if v, ok := opts["baud"]; ok {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.Baud = n
		}
	}
	if v, ok := opts["path_autodiscover"]; ok {
		c.PathAutodiscover = truthy(v)
	}
	if v, ok := opts["wire_format"]; ok && v != "" {
		c.WireFormat = v
	}
	if v, ok := opts["max_line"]; ok {
		if n, err := strconv.Atoi(v); err == nil && n >= 64 {
			c.MaxLine = uint(n)
		}
	}
	if v, ok := opts["pages"]; ok && v != "" {
		c.Pages = v
	}
	if v, ok := opts["demo_mode"]; ok {
		c.DemoMode = truthy(v)
	}
	if v, ok := opts["screen_timeout"]; ok {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			c.ScreenTimeoutSec = uint(n)
		}
	}
	if v, ok := opts["screen_timeout_mode"]; ok && v != "" {
		c.ScreenTimeoutMode = v
	}
	if v, ok := opts["push_alerts"]; ok {
		c.PushAlerts = truthy(v)
	}
	if v, ok := opts["wan_if"]; ok && v != "" {
		c.WanIf = v
	}
	if v, ok := opts["lan_if"]; ok && v != "" {
		c.LanIf = v
	}
	if v, ok := opts["wifi_if"]; ok && v != "" {
		c.WifiIf = v
	}
	if v, ok := opts["interval_system"]; ok {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.IntervalSystemMs = uint(n)
		}
	}
	if v, ok := opts["interval_network"]; ok {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.IntervalNetworkMs = uint(n)
		}
	}
	if v, ok := opts["log_level"]; ok && v != "" {
		c.LogLevel = v
	}
	if v, ok := opts["debug"]; ok {
		c.Debug = truthy(v)
	}
	if v, ok := opts["debug_serial"]; ok {
		c.DebugSerial = truthy(v)
	}
	if v, ok := opts["menu_nav_button"]; ok && v != "" {
		c.MenuNavButton = v
	}
	if v, ok := opts["menu_select_button"]; ok && v != "" {
		c.MenuSelectButton = v
	}
	if v, ok := opts["menu_wps"]; ok {
		c.MenuWPS = truthy(v)
	}
}

func normalize(c *Config) {
	c.WireFormat = strings.ToLower(strings.TrimSpace(c.WireFormat))
	c.ScreenTimeoutMode = strings.ToLower(strings.TrimSpace(c.ScreenTimeoutMode))
	c.LogLevel = strings.ToLower(strings.TrimSpace(c.LogLevel))
	if c.Debug && c.LogLevel == LogInfo {
		c.LogLevel = LogDebug
	}
}

func truthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// Legacy aliases used by older call sites / tests.
const UCIPath = DefaultUCIPath

// LoadFile loads a UCI-format file (test/compat helper).
func LoadFile(path string) (Config, error) {
	cfg, _, err := LoadPath(path)
	return cfg, err
}
