"""Protocol-fault stress sample: a minimal custom server (not the template's
server.py -- allowPlumbing:true) whose /health is fine but whose /move
replies 200 with a body that isn't valid JSON. The template's real server
would never do this (it always emits valid JSON); this simulates a student
who hand-rolled their own broken response formatting.
"""

import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, content_type="application/json"):
        payload = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self._send(200, "")

    def do_GET(self):
        if self.path == "/health":
            self._send(200, "ok", "text/plain")
        else:
            self._send(404, "")

    def do_POST(self):
        if self.path == "/move":
            length = int(self.headers.get("Content-Length", 0))
            self.rfile.read(length)
            self._send(200, "{not valid json!!")  # deliberately broken
        else:
            self._send(404, "")

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
