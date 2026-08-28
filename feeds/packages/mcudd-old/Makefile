#
# Copyright (C) 2026 OpenWrt.org
#
# Legacy C mcudd daemon (archived). Production images use feeds/packages/mcudd (Go).
#

include $(TOPDIR)/rules.mk

PKG_NAME:=mcudd-old
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>
PKG_LICENSE:=GPL-3.0-or-later

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

define Package/mcudd-old
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=MCU display daemon (legacy C / RDCP v1)
  URL:=https://github.com/T-REX-XP/openwrt-packages
endef

define Package/mcudd-old/description
  Archived C implementation of mcudd for reference and regression tests.
  Not installed on CM5 images — use the Go mcudd package instead.
endef

define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) ./src $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(MAKE) -C $(PKG_BUILD_DIR)/src \
		CC="$(TARGET_CC)" \
		CFLAGS="$(TARGET_CFLAGS) -Wall -Wextra -std=c99 -D_GNU_SOURCE" \
		LDFLAGS="$(TARGET_LDFLAGS) -lpthread"
endef

define Package/mcudd-old/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/src/mcudd-bin $(1)/usr/sbin/mcudd-old
endef

$(eval $(call BuildPackage,mcudd-old))
