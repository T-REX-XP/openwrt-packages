# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Threat Prevention (Suricata IDS + ET Open)
LUCI_DEPENDS:=+luci-base +tp-eventd +suricata +suricata-etopen
LUCI_PKGARCH:=all
PKG_RELEASE:=7

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>

# include/scan.mk only indexes dirs whose Makefile matches "call BuildPackage"; the real call is in luci.mk.
# call BuildPackage

include $(TOPDIR)/feeds/luci/luci.mk
