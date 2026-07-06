#!/bin/sh
# Hotplug helper — log interface events for mcudd (push in Phase 2).

ACTION="${ACTION:-}"
DEVICE="${DEVICE:-}"
INTERFACE="${INTERFACE:-}"

logger -t mcudd "net event action=${ACTION} dev=${DEVICE} if=${INTERFACE}"
exit 0
