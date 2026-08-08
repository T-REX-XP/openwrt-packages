#
# Copyright (C) 2026 OpenWrt.org
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#
# Package for https://github.com/yggdrasil-network/yggdrasil-go
# Based on openwrt/packages net/yggdrasil (netifd proto integration).
#

include $(TOPDIR)/rules.mk

PKG_NAME:=yggdrasil
PKG_VERSION:=0.5.14
PKG_RELEASE:=1

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/yggdrasil-network/yggdrasil-go/tar.gz/v$(PKG_VERSION)?
PKG_HASH:=afed8dd1002b322eef51f1869cab19d96b3774eba1339b5f4088b85d1f8acd0a
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-go-$(PKG_VERSION)

PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>
PKG_LICENSE:=LGPL-3.0-only
PKG_LICENSE_FILES:=LICENSE

PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1
PKG_BUILD_FLAGS:=no-mips16

GO_PKG:=github.com/yggdrasil-network/yggdrasil-go
GO_PKG_BUILD_PKG:=github.com/yggdrasil-network/yggdrasil-go/cmd/...

GO_PKG_LDFLAGS_X:= \
	github.com/yggdrasil-network/yggdrasil-go/src/version.buildName=yggdrasil-openwrt \
	github.com/yggdrasil-network/yggdrasil-go/src/version.buildVersion=$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/yggdrasil
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Routing and Redirection
  TITLE:=End-to-end encrypted IPv6 overlay network
  URL:=https://github.com/yggdrasil-network/yggdrasil-go
  DEPENDS:=$(GO_ARCH_DEPENDS) @IPV6 +kmod-tun
endef

define Package/yggdrasil/description
  Yggdrasil is a fully end-to-end encrypted IPv6 overlay network.
  Lightweight and self-arranging; works over IPv4 or IPv6 underlays.
  This package installs yggdrasil, yggdrasilctl, and a netifd protocol
  helper. Configure via LuCI with luci-proto-yggdrasil (ImmortalWrt luci feed).
endef

define Package/yggdrasil/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) $(GO_PKG_BUILD_BIN_DIR)/yggdrasil $(1)/usr/sbin/
	$(INSTALL_BIN) $(GO_PKG_BUILD_BIN_DIR)/yggdrasilctl $(1)/usr/sbin/
	$(INSTALL_DIR) $(1)/lib/netifd/proto
	$(INSTALL_BIN) ./files/yggdrasil.sh $(1)/lib/netifd/proto/yggdrasil.sh
endef

$(eval $(call GoBinPackage,yggdrasil))
$(eval $(call BuildPackage,yggdrasil))
