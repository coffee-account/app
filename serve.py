"""Local preview of the web app without browser caching.

    python3 serve.py          # http://localhost:8000
    python3 serve.py 8080     # another port
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent / "web"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


handler = functools.partial(NoCacheHandler, directory=str(ROOT))
print(f"Serving {ROOT} at http://localhost:{PORT} (Ctrl+C to stop)")
http.server.ThreadingHTTPServer(("", PORT), handler).serve_forever()
