package version

import "fmt"

const (
	RDCP          = 1
	Stack         = "1.0.0"
	Release       = 47
	PagesSchema   = 1
	ComponentHost = "mcudd"
	ComponentFW   = "esp32-router"
)

func String() string {
	return fmt.Sprintf("%s+%d", Stack, Release)
}

// JSON returns a machine-readable host version blob for LuCI / tooling.
func JSON() string {
	return fmt.Sprintf(`{"stack":"%s","release":%d,"rdcp":%d,"pages_schema":%d,"component":"%s"}`,
		Stack, Release, RDCP, PagesSchema, ComponentHost)
}

func Compatible(fwStack string, fwRelease, fwRDCP uint) bool {
	return fwStack == Stack && fwRelease == Release && fwRDCP == RDCP
}
