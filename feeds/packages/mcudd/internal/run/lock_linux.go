//go:build linux

package run

import (
	"fmt"
	"os"
	"syscall"
)

const lockFile = "/var/run/mcudd.lock"

// AcquireLock ensures a single mcudd instance.
func AcquireLock() (release func(), err error) {
	f, err := os.OpenFile(lockFile, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, fmt.Errorf("another mcudd instance is running")
	}
	return func() {
		syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}, nil
}
