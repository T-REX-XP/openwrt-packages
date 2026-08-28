package version

import "testing"

func TestVersion(t *testing.T) {
	if String() != "1.0.0+44" {
		t.Fatal(String())
	}
	if !Compatible(Stack, Release, RDCP) {
		t.Fatal("compatible")
	}
	if Compatible("0.0.0", 1, 1) {
		t.Fatal("incompatible")
	}
}
