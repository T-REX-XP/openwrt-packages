# SPDX-License-Identifier: GPL-2.0-or-later
#
# Originally vendored from community LuCI for Snort3:
# https://github.com/dddavid51/luci-snort3-openwrt (upstream v3.6, 2025-11)
# Rewritten as LuCI JS + rpcd/ucode for ImmortalWrt 25.x (no luci.cbi).

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI for Snort3 IDS/IPS
LUCI_DEPENDS:=+luci-base +snort3
LUCI_PKGARCH:=all

PKG_VERSION:=3.6
PKG_RELEASE:=10

PKG_LICENSE:=GPL-2.0-or-later
PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>

define Package/luci-app-snort3/description
	LuCI interface for Snort3 (IDS/IPS) on ImmortalWrt 25.x.
	Configure Snort via UCI, view alerts, update rules, and control the service
	under Services → Snort IDS/IPS.
endef

# include/scan.mk only indexes dirs whose Makefile matches "call BuildPackage"; the real call is in luci.mk.
# call BuildPackage

include $(TOPDIR)/feeds/luci/luci.mk
