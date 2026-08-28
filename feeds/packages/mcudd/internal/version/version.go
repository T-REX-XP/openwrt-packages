package version

import "fmt"

const (
	RDCP         = 1
	Stack        = "1.0.0"
	Release      = 45
	PagesSchema  = 1
	ComponentHost = "mcudd"
	ComponentFW   = "esp32-router"
)

func String() string {
	return fmt.Sprintf("%s+%d", Stack, Release)
}

func Compatible(fwStack string, fwRelease, fwRDCP uint) bool {
	return fwStack == Stack && fwRelease == Release && fwRDCP == RDCP
}
