#
# Fetch live Emerging Threats Open (Suricata 7) into /etc/suricata/rules.
# Does not vendor Synology ET 9840.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=suricata-etopen
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/suricata-etopen
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Routing and Redirection
  TITLE:=ET Open rules fetcher for Suricata 7
  DEPENDS:=+uclient-fetch +ca-bundle
  PKGARCH:=all
endef

define Package/suricata-etopen/description
  Downloads Proofpoint Emerging Threats Open for Suricata 7.0 into
  /etc/suricata/rules. Small profile by default (UCI suricata.main.rule_profile).
  Not in the default CM5 image.
endef

define Build/Prepare
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/suricata-etopen/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/usr/sbin/suricata-etopen-fetch $(1)/usr/sbin/suricata-etopen-fetch
endef

$(eval $(call BuildPackage,suricata-etopen))
