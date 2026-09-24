"""Protocol-fault stress sample: /health is fine, /move reads the request
and then blocks forever without ever writing a response. The arena's chess
clock is wall-clock, request-sent -> response-fully-received, so this drains
the clock -> game_forfeit(clock_expired)."""

import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        payload = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Length", str(len(payload)))
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self._send(200, "")

    def do_GET(self):
        self._send(200 if self.path == "/health" else 404, "")

    def do_POST(self):
        if self.path == "/move":
            length = int(self.headers.get("Content-Length", 0))
            self.rfile.read(length)
            threading.Event().wait()  # block forever; never respond
        else:
            self._send(404, "")

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
