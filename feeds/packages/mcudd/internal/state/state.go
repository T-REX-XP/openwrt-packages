package state

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/proto"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/version"
)

type Writer struct {
	Dir string
}

func (w Writer) path(name string) string {
	if w.Dir == "" {
		return name
	}
	return filepath.Join(w.Dir, filepath.Base(name))
}

func (w Writer) WriteActiveScreen(screenID string) error {
	if screenID == "" {
		return nil
	}
	return os.WriteFile(w.path("/tmp/mcud_active_screen"), []byte(screenID+"\n"), 0o644)
}

func (w Writer) WriteFirmwareVersion(msg proto.Message) error {
	synced := version.Compatible(msg.VersionStack, msg.VersionRelease, msg.VersionRDCP)
	body := fmt.Sprintf(`{"stack":"%s","release":%d,"component":"%s","rdcp":%d,"synced":%t}`+"\n",
		msg.VersionStack, msg.VersionRelease, msg.VersionComponent, msg.VersionRDCP, synced)
	return os.WriteFile(w.path("/tmp/mcud_firmware_version.json"), []byte(body), 0o644)
}

type LinkTest struct {
	PingOK    bool
	PingID    uint
	UptimeMS  uint
	EchoOK    bool
	EchoText  string
	UpdatedAt int64
}

func (w Writer) WriteLinkTest(lt LinkTest) error {
	if lt.UpdatedAt == 0 {
		lt.UpdatedAt = time.Now().Unix()
	}
	escaped := strings.ReplaceAll(lt.EchoText, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `"`, `\"`)
	body := fmt.Sprintf(`{"ping_ok":%t,"ping_id":%d,"uptime_ms":%d,"echo_ok":%t,"echo_text":"%s","updated_at":%d}`+"\n",
		lt.PingOK, lt.PingID, lt.UptimeMS, lt.EchoOK, escaped, lt.UpdatedAt)
	return os.WriteFile(w.path("/tmp/mcud_link_test.json"), []byte(body), 0o644)
}

type BootState struct {
	Stage   string
	Message string
	Pct     int
}

func ReadBootState(path string) BootState {
	bs := BootState{Stage: "boot", Message: "Booting...", Pct: 10}
	data, err := os.ReadFile(path)
	if err != nil {
		return bs
	}
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key, val := parts[0], parts[1]
		switch key {
		case "stage":
			bs.Stage = val
		case "message":
			bs.Message = val
		case "pct":
			fmt.Sscanf(val, "%d", &bs.Pct)
		}
	}
	if bs.Pct > 100 {
		bs.Pct = 100
	}
	if bs.Pct < 0 {
		bs.Pct = 0
	}
	return bs
}

func (bs BootState) Ready() bool {
	return bs.Stage == "ready"
}
