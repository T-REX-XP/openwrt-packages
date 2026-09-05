#
# Fetch live Emerging Threats Open (Suricata 8) into /etc/suricata/rules.
# Does not vendor Synology ET 9840.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=suricata-etopen
PKG_VERSION:=1.0
PKG_RELEASE:=4

PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/suricata-etopen
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Routing and Redirection
  TITLE:=ET Open rules fetcher for Suricata 8
  DEPENDS:=+uclient-fetch +ca-bundle
  PKGARCH:=all
endef

define Package/suricata-etopen/description
  Downloads Proofpoint Emerging Threats Open for Suricata 8.0 into
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
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/etc/init.d
	$(INSTALL_BIN) ./files/usr/sbin/suricata-etopen-fetch $(1)/usr/sbin/suricata-etopen-fetch
	$(INSTALL_BIN) ./files/suricata-etopen.init $(1)/etc/init.d/suricata-etopen
endef

define Package/suricata-etopen/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
# Oneshot fetcher — LuCI starts it; do not download on every boot.
/etc/init.d/suricata-etopen disable >/dev/null 2>&1 || true
exit 0
endef

$(eval $(call BuildPackage,suricata-etopen))
