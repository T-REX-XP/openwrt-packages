#
# Copyright (C) 2026 OpenWrt.org
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=blocky
PKG_VERSION:=0.32.1
PKG_RELEASE:=21

PKG_SOURCE:=v$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://github.com/0xERR0R/blocky/archive/refs/tags
PKG_HASH:=c61ef1b8e1ea194602be1cb617c8e6896f3a64c1226f877f20dd23bba46d695f

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
  DEPENDS:=$(GO_ARCH_DEPENDS) +ca-bundle +uclient-fetch
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
	$(INSTALL_BIN) ./files/blocky-lan.init $(1)/etc/init.d/blocky-lan
	$(INSTALL_DIR) $(1)/etc/blocky
	$(INSTALL_CONF) ./files/config.yml $(1)/etc/blocky/config.yml
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/blocky $(1)/etc/config/blocky
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/usr/sbin/blocky-dnsmasq-sync $(1)/usr/sbin/blocky-dnsmasq-sync
	$(INSTALL_BIN) ./files/usr/sbin/blocky-lists-sync $(1)/usr/sbin/blocky-lists-sync
	$(INSTALL_BIN) ./files/usr/sbin/blocky-lists-refresh $(1)/usr/sbin/blocky-lists-refresh
	$(INSTALL_BIN) ./files/usr/sbin/blocky-http-api $(1)/usr/sbin/blocky-http-api
	$(INSTALL_BIN) ./files/usr/sbin/blocky-config-apply $(1)/usr/sbin/blocky-config-apply
	$(INSTALL_BIN) ./files/usr/sbin/blocky-boot $(1)/usr/sbin/blocky-boot
	$(INSTALL_DIR) $(1)/etc/hotplug.d/iface
	$(INSTALL_BIN) ./files/etc/hotplug.d/iface/99-blocky-wan $(1)/etc/hotplug.d/iface/99-blocky-wan
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/blocky.defaults $(1)/etc/uci-defaults/90-blocky-enable
	$(INSTALL_BIN) ./files/blocky-bootstrap.defaults $(1)/etc/uci-defaults/91-blocky-bootstrap
	$(INSTALL_BIN) ./files/blocky-ensure.defaults $(1)/etc/uci-defaults/94-blocky-ensure
endef

define Package/blocky/postinst
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ]; then
	/etc/init.d/blocky enable 2>/dev/null || true
	if /etc/init.d/blocky running 2>/dev/null; then
		/etc/init.d/blocky restart
	else
		/etc/init.d/blocky start
	fi
fi
exit 0
endef

$(eval $(call GoBinPackage,blocky))
$(eval $(call BuildPackage,blocky))
