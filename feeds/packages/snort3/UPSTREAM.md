# snort3 — upstream notes

Vendored from [openwrt/packages `net/snort3`](https://github.com/openwrt/packages/tree/master/net/snort3) (GPL-2.0-only).

| Item | Value |
|------|--------|
| Upstream | snort3 **3.12.2.0**, `PKG_RELEASE` 1 |
| This feed | same version; CM5 UCI overlay (`br-lan`, IDS, AF_PACKET, `192.168.8.0/24`, disabled) |
| LuCI | **luci-app-snort3** in this feed |

**Not** in the default CM5 image. Compile in Docker (`make package/snort3/compile`); GitHub SDK CI skips the engine (needs `libdaq3`, `luajit`, long C++ build). `libdaq3` still comes from the ImmortalWrt packages feed.

Refresh:

```sh
# Re-copy Makefile, files/, patches/ from openwrt/packages net/snort3
# Keep CM5 snort.config defaults and /etc/capabilities/snort.json install.
```
