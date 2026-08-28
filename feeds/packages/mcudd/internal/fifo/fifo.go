package fifo

import (
	"strings"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/pages"
)

type Command struct {
	Kind   Kind
	Screen string
	Echo   string
}

type Kind int

const (
	KindUnknown Kind = iota
	KindPrev
	KindNext
	KindBoot
	KindReady
	KindScreen
	KindRefresh
	KindVersion
	KindPing
	KindEcho
)

func Parse(line string) (Command, bool) {
	line = strings.TrimSpace(line)
	if line == "" {
		return Command{}, false
	}
	switch line {
	case "prev":
		return Command{Kind: KindPrev}, true
	case "next":
		return Command{Kind: KindNext}, true
	case "boot":
		return Command{Kind: KindBoot}, true
	case "ready":
		return Command{Kind: KindReady}, true
	case "version":
		return Command{Kind: KindVersion}, true
	case "ping":
		return Command{Kind: KindPing}, true
	case "net", "refresh":
		return Command{Kind: KindRefresh}, true
	}
	if strings.HasPrefix(line, "screen ") {
		screen := strings.TrimSpace(line[7:])
		if pages.Known(screen) {
			return Command{Kind: KindScreen, Screen: screen}, true
		}
		return Command{}, false
	}
	if strings.HasPrefix(line, "echo ") {
		text := line[5:]
		if text != "" {
			return Command{Kind: KindEcho, Echo: text}, true
		}
	}
	return Command{}, false
}
