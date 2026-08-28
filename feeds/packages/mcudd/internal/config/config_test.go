package config

import "testing"

func TestDefault(t *testing.T) {
	c := Default()
	if c.Path != "/dev/ttyS2" || c.Baud != 115200 || c.MaxLine != 4096 {
		t.Fatalf("%+v", c)
	}
}
