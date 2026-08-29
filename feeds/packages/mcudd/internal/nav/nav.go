package nav

import (
	"time"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/pages"
)

const (
	MinInterval = 450 * time.Millisecond
	AckTimeout  = 2500 * time.Millisecond
)

type Clock interface {
	Now() time.Time
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

// Controller tracks screen command pending state and rate limits.
type Controller struct {
	Clock Clock

	ActiveScreen    string
	CommandedScreen string
	PendingScreen   string
	Pending         bool
	LastTX          time.Time
}

func New() *Controller {
	return &Controller{
		Clock:        realClock{},
		ActiveScreen: pages.BootScreen,
	}
}

func (c *Controller) ClearPending() {
	c.Pending = false
	c.PendingScreen = ""
}

func (c *Controller) Busy(now time.Time) bool {
	if c.Pending {
		if !c.LastTX.IsZero() && now.Sub(c.LastTX) > AckTimeout {
			c.ClearPending()
		} else if c.Pending {
			return true
		}
	}
	if !c.LastTX.IsZero() && now.Sub(c.LastTX) < MinInterval {
		return true
	}
	return false
}

func (c *Controller) Allow(now time.Time) bool {
	return !c.Busy(now)
}

// Cursor is the last commanded or acked page — used so next/prev can walk
// the ring before evt screen arrives.
func (c *Controller) Cursor() string {
	if c.CommandedScreen != "" {
		return c.CommandedScreen
	}
	return c.ActiveScreen
}

func (c *Controller) MarkCommanded(screenID string) {
	if pages.Known(screenID) {
		c.CommandedScreen = screenID
	}
}

// AllowUserNav lets LuCI/FIFO next/prev supersede an outstanding screen ack.
// Only the 450ms interval applies; a missing evt screen must not freeze nav.
func (c *Controller) AllowUserNav(now time.Time) bool {
	if c.Pending && !c.LastTX.IsZero() && now.Sub(c.LastTX) > AckTimeout {
		c.ClearPending()
	}
	if !c.LastTX.IsZero() && now.Sub(c.LastTX) < MinInterval {
		return false
	}
	return true
}

func (c *Controller) MarkSent(screenID string, now time.Time) {
	if pages.Known(screenID) {
		c.PendingScreen = screenID
		c.Pending = true
		c.LastTX = now
	}
}

func (c *Controller) AckScreen(screenID string) {
	c.ClearPending()
	c.ActiveScreen = screenID
	c.CommandedScreen = screenID
}
