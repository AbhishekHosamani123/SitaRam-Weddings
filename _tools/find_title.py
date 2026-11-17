#!/usr/bin/env python3
"""Locate the runtime-assembled 'Ram Mandir' title string (possibly
escaped as \\uXXXX sequences) across public files."""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MIR = os.path.join("public", "mirror", "framerusercontent.com", "sites",
                   "1Jnwf2uoy3TohI0oOnOtPi")
targets = [os.path.join(MIR, n) for n in sorted(os.listdir(MIR))
           if n.endswith((".mjs", ".json"))] + [os.path.join("public", "index.html")]


def decode_escapes(txt):
    out = []
    i = 0
    n = len(txt)
    while i < n:
        if txt[i] == "\\" and i + 5 < n and txt[i + 1] == "u":
            hex4 = txt[i + 2:i + 6]
            try:
                out.append(chr(int(hex4, 16)))
                i += 6
                continue
            except ValueError:
                pass
        out.append(txt[i])
        i += 1
    return "".join(out)


for f in targets:
    with open(f, encoding="utf-8", errors="replace") as fh:
        txt = fh.read()
    decoded = decode_escapes(txt)
    for needle in ("Ram Mandir", "Mandir", "Ram Sita"):
        start = 0
        hits = []
        while True:
            i = decoded.find(needle, start)
            if i < 0:
                break
            hits.append(i)
            start = i + 1
        if hits:
            print(f"{os.path.basename(f)}: '{needle}' x{len(hits)}")
            for i in hits[:3]:
                ctx = decoded[max(0, i - 70):i + 40].replace("\n", " ")
                print(f"    ctx: {ctx}")
