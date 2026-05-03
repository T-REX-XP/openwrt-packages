#
# Copyright (C) 2026 OpenWrt.org
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=blocky
PKG_VERSION:=0.29.0
PKG_RELEASE:=3

PKG_SOURCE:=v$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://github.com/0xERR0R/blocky/archive/refs/tags
PKG_HASH:=4f384230965c3cf9a6cd977e2c28cfb711e1e383f9d022c78295cf896ecf9bed

PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>
PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE

PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1
PKG_USE_MIPS16:=0

GO_PKG:=github.com/0xERR0R/blocky
GO_PKG_BUILD_PKG:=github.com/0xERR0R/blocky
GO_PKG_LDFLAGS_X:= \
	github.com/0xERR0R/blocky/util.Version=v$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/blocky
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Fast DNS proxy and ad-blocker
  URL:=https://github.com/0xERR0R/blocky
  DEPENDS:=$(GO_ARCH_DEPENDS) +ca-bundle
endef

define Package/blocky/description
  Blocky is a DNS proxy and ad-blocker for local networks with external
  blocklists, upstream groups, DNS caching, DNS-over-HTTPS, DNS-over-TLS,
  Prometheus metrics, and YAML configuration.
endef

define Package/blocky/conffiles
/etc/blocky/config.yml
/etc/config/blocky
endef

define Package/blocky/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(GO_PKG_BUILD_BIN_DIR)/blocky $(1)/usr/bin/blocky
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/blocky.init $(1)/etc/init.d/blocky
	$(INSTALL_DIR) $(1)/etc/blocky
	$(INSTALL_CONF) ./files/config.yml $(1)/etc/blocky/config.yml
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/blocky $(1)/etc/config/blocky
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/usr/sbin/blocky-dnsmasq-sync $(1)/usr/sbin/blocky-dnsmasq-sync
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/blocky.defaults $(1)/etc/uci-defaults/90-blocky-enable
endef

$(eval $(call GoBinPackage,blocky))
$(eval $(call BuildPackage,blocky))
