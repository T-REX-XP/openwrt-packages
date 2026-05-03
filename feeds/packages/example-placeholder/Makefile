# SPDX-License-Identifier: GPL-2.0-only
#
# Example package — remove or replace when you add real recipes.

include $(TOPDIR)/rules.mk

PKG_NAME:=example-placeholder
PKG_VERSION:=1
PKG_RELEASE:=1

PKG_MAINTAINER:=You <you@example.com>

include $(INCLUDE_DIR)/package.mk

define Package/example-placeholder
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Example placeholder for the openwrt-packages feed
  PKGARCH:=all
endef

define Package/example-placeholder/description
  Minimal no-arch package proving the feed layout works.
  Delete this directory once you add your own packages under feeds/packages/.
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/example-placeholder/install
	$(INSTALL_DIR) $(1)/usr/share/doc/$(PKG_NAME)
	$(INSTALL_DATA) ./files/README.txt $(1)/usr/share/doc/$(PKG_NAME)/README.txt
endef

$(eval $(call BuildPackage,example-placeholder))
