# snort3 — upstream notes

Vendored from [openwrt/packages `net/snort3`](https://github.com/openwrt/packages/tree/master/net/snort3) (GPL-2.0-only).

| Item | Value |
|------|--------|
| Upstream | snort3 **3.12.2.0**, `PKG_RELEASE` 1 |
| This feed | same version; CM5 UCI overlay (`br-lan`, IDS, AF_PACKET, `192.168.8.0/24`, disabled) |
| LuCI | **luci-app-snort3** in this feed |

**Not** in the default CM5 image. GitHub SDK CI compiles and publishes the engine (`libdaq3` + `luajit` from ImmortalWrt `packages`). Docker `make package/snort3/compile` still works for local firmware builds.

Refresh:

```sh
# Re-copy Makefile, files/, patches/ from openwrt/packages net/snort3
# Keep CM5 snort.config defaults and /etc/capabilities/snort.json install.
```
