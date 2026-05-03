# SPDX-License-Identifier: Apache-2.0
#
# LuCI app for editing OpenWrt hotplug button scripts.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for GPIO button scripts
LUCI_DEPENDS:=+luci-base +kmod-gpio-button-hotplug
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Immortal OPI CM5 overlay

# include/scan.mk only indexes dirs whose Makefile matches "call BuildPackage"; the real call is in luci.mk.
# call BuildPackage

include $(TOPDIR)/feeds/luci/luci.mk
