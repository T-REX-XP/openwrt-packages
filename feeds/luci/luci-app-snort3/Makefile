# SPDX-License-Identifier: GPL-2.0-or-later
#
# Vendored from community LuCI for Snort3 on OpenWrt:
# https://github.com/dddavid51/luci-snort3-openwrt (upstream v3.6, 2025-11)
#
# Upstream install.sh and src/ trees were partially corrupted; this feed packages
# repaired luasrc/po files compatible with ImmortalWrt luci-lua-runtime.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI for Snort3 IDS/IPS (community)
LUCI_DEPENDS:=+luci-base +luci-lua-runtime +snort3
LUCI_PKGARCH:=all

PKG_VERSION:=3.6
PKG_RELEASE:=2

PKG_LICENSE:=GPL-2.0-or-later
PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>

define Package/luci-app-snort3/description
	Community LuCI interface for Snort3 (IDS/IPS) on OpenWrt / ImmortalWrt.
	Configure Snort via UCI, view alerts, update rules, and control the service
	under Services → Snort IDS/IPS. Requires the snort3 package and
	/etc/config/snort (created when snort3 is installed).
endef

# include/scan.mk only indexes dirs whose Makefile matches "call BuildPackage"; the real call is in luci.mk.
# call BuildPackage

include $(TOPDIR)/feeds/luci/luci.mk
