# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI security and privacy test guide
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all
PKG_VERSION:=2026.04.26
PKG_RELEASE:=3

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>

# include/scan.mk only indexes dirs whose Makefile matches "call BuildPackage"; the real call is in luci.mk.
# call BuildPackage

include $(TOPDIR)/feeds/luci/luci.mk
