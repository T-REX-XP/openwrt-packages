package version

import (
	"strings"
	"testing"
)

func TestVersion(t *testing.T) {
	if String() != "1.0.0+47" {
		t.Fatal(String())
	}
	if !strings.Contains(JSON(), `"release":47`) {
		t.Fatal(JSON())
	}
	if !Compatible(Stack, Release, RDCP) {
		t.Fatal("compatible")
	}
	if Compatible("0.0.0", 1, 1) {
		t.Fatal("incompatible")
	}
}
