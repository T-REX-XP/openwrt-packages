# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for Internet speed tests
LUCI_DEPENDS:=+luci-base +speedtest-go +ca-bundle
LUCI_PKGARCH:=all
PKG_VERSION:=2026.04.26
PKG_RELEASE:=2

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Immortal OPI CM5 overlay

# include/scan.mk only indexes dirs whose Makefile matches "call BuildPackage"; the real call is in luci.mk.
# call BuildPackage

include $(TOPDIR)/feeds/luci/luci.mk
