#!/usr/bin/env python3
"""Round 2 of cache-busting:
- The user's phone cached script_main.v2/VR998.v2 (immutable) during the window
  when the v2 bundle still pointed at the old texture path. Rename both to v3
  so any browser is forced to fetch fresh. Old v2 files are KEPT on the server
  as a safety net for stale-HTML edge cases.
- Fix vercel.json: bundles/JSON under sites/ become must-revalidate (so future
  content edits propagate on a normal refresh); images/fonts stay immutable.
"""
from pathlib import Path

PUB = Path(r"D:\Wedding website\Framer\public")
SITE = PUB / "mirror" / "framerusercontent.com" / "sites" / "1Jnwf2uoy3TohI0oOnOtPi"

VR2 = "VR998DU3WSRaZIpYrcWhMoQxMWGXSrJFDK6jx2eUMjE.DKHZzuKc.v2.mjs"
VR3 = "VR998DU3WSRaZIpYrcWhMoQxMWGXSrJFDK6jx2eUMjE.DKHZzuKc.v3.mjs"
SM2 = "script_main.BNALTGIK.v2.mjs"
SM3 = "script_main.BNALTGIK.v3.mjs"

# 1. VR998 v3 = exact copy of v2 (it already references the .v2.png texture)
v2 = (SITE / VR2).read_text(encoding="utf-8")
(SITE / VR3).write_text(v2, encoding="utf-8", newline="\n")
print(f"created {VR3} ({len(v2)} chars)")

# 2. script_main v3 = copy of v2 with the VR998 import pointed at v3
sm = (SITE / SM2).read_text(encoding="utf-8")
n = sm.count(VR2)
sm = sm.replace(VR2, VR3)
(SITE / SM3).write_text(sm, encoding="utf-8", newline="\n")
print(f"created {SM3} ({n} import ref updated)")

# 3. index.html -> v3 references
html_path = PUB / "index.html"
html = html_path.read_text(encoding="utf-8")
for a, b in ((SM2, SM3), (VR2, VR3)):
    c = html.count(a)
    html = html.replace(a, b)
    print(f"index.html: {c}x {a.split('.')[0]} -> v3")
html_path.write_text(html, encoding="utf-8", newline="\n")

# 4. vercel.json: non-overlapping cache rules
vj = Path(r"D:\Wedding website\Framer\vercel.json")
vj.write_text(
    """{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "version": 2,
  "outputDirectory": "public",
  "framework": null,
  "headers": [
    {
      "source": "/mirror/framerusercontent.com/sites/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source": "/mirror/framerusercontent.com/images/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    },
    {
      "source": "/mirror/framerusercontent.com/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    },
    {
      "source": "/mirror/images.unsplash.com/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    },
    {
      "source": "/mirror/fonts.gstatic.com/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ],
  "trailingSlash": false
}
""",
    encoding="utf-8",
)
print("vercel.json updated: sites -> must-revalidate, images/fonts -> immutable")

# 5. sanity: no stale refs
stale = []
for f in list(PUB.rglob("*.mjs")) + list(PUB.rglob("*.html")):
    t = f.read_text(encoding="utf-8", errors="ignore")
    if SM2 in t or VR2 in t:
        if f.name not in (SM2, VR2, SM3, VR3):
            stale.append(f"{f.name}")
print("stale refs outside v2/v3 pairs:", stale or "none")
