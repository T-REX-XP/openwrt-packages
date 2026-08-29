#
# Copyright (C) 2026 OpenWrt.org
#
# mcudd — Go UART daemon for ESP32 MCU display (RDCP v1)
#

include $(TOPDIR)/rules.mk

PKG_NAME:=mcudd
PKG_VERSION:=1.0.0
PKG_RELEASE:=5

PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>
PKG_LICENSE:=Apache-2.0

PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1
PKG_USE_MIPS16:=0

GO_PKG:=github.com/t-rex-xp/openwrt-packages/mcudd
GO_PKG_BUILD_PKG:=./cmd/mcudd
GO_PKG_LDFLAGS_X:= \
	github.com/t-rex-xp/openwrt-packages/mcudd/internal/version.Stack=1.0.0 \
	github.com/t-rex-xp/openwrt-packages/mcudd/internal/version.Release=47

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/mcudd
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=MCU display daemon (Go / RDCP v1)
  URL:=https://github.com/T-REX-XP/openwrt-packages
  DEPENDS:=$(GO_ARCH_DEPENDS)
endef

define Package/mcudd/description
  Host-side UART bridge for ESP32 smart display panels on ImmortalWrt.
  Speaks RDCP v1 JSON over serial; replaces the legacy C mcudd binary.
  Configuration: /etc/config/mcud (UCI).
endef

define Package/mcudd/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) $(GO_PKG_BUILD_BIN_DIR)/mcudd $(1)/usr/sbin/mcudd
endef

$(eval $(call BuildPackage,mcudd))
