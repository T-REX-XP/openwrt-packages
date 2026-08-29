package pages

import (
	"encoding/json"
	"fmt"
	"os"
)

const BootScreen = "router_boot"

var defaultRing = []string{
	"router_system",
	"router_network",
	"router_clients",
	"router_storage",
	"router_wifi",
	"router_security",
}

// Ring is the active page order (boot is not included).
var Ring = append([]string{}, defaultRing...)

type pagesFile struct {
	Screens []struct {
		ID      string `json:"id"`
		Enabled *bool  `json:"enabled"`
	} `json:"screens"`
}

func ResetDefault() {
	Ring = append([]string{}, defaultRing...)
}

func LoadFile(path string) error {
	if path == "" {
		ResetDefault()
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var doc pagesFile
	if err := json.Unmarshal(data, &doc); err != nil {
		return fmt.Errorf("pages json: %w", err)
	}
	var next []string
	for _, s := range doc.Screens {
		if s.ID == "" || s.ID == BootScreen {
			continue
		}
		if s.Enabled != nil && !*s.Enabled {
			continue
		}
		next = append(next, s.ID)
	}
	if len(next) == 0 {
		return fmt.Errorf("pages json: no enabled screens")
	}
	Ring = next
	return nil
}

func Known(screenID string) bool {
	if screenID == BootScreen {
		return true
	}
	return Index(screenID) >= 0
}

func Index(screenID string) int {
	for i, id := range Ring {
		if id == screenID {
			return i
		}
	}
	return -1
}

// Neighbor returns the next screen when swiping dir (left=next, right=prev).
func Neighbor(screenID, dir string) string {
	if screenID == "" || screenID == BootScreen {
		return Ring[0]
	}
	idx := Index(screenID)
	if idx < 0 {
		idx = 0
	}
	if dir == "right" {
		idx = (idx + len(Ring) - 1) % len(Ring)
	} else {
		idx = (idx + 1) % len(Ring)
	}
	return Ring[idx]
}
