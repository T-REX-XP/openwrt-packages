package pages

const BootScreen = "router_boot"

var Ring = []string{
	"router_system",
	"router_network",
	"router_clients",
	"router_storage",
	"router_wifi",
	"router_security",
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
