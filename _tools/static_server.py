#!/usr/bin/env python3
"""Tiny static file server with correct MIME types (incl. .mjs).
Used only to verify the site as static hosting (like Vercel) would
serve it: query strings are ignored, extensions drive content-type."""
import os
import http.server
import sys

ROOT = r"D:\Wedding website\Framer\public"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099

EXT_TYPES = {
    ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css",
    ".html": "text/html", ".json": "application/json", ".png": "image/png",
    ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".mp3": "audio/mpeg",
    ".mp4": "video/mp4", ".woff2": "font/woff2", ".woff": "font/woff",
    ".ico": "image/x-icon", ".avif": "image/avif", ".txt": "text/plain",
}


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in EXT_TYPES:
            return EXT_TYPES[ext]
        return "application/octet-stream"

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
