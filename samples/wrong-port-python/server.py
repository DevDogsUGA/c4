"""Protocol/lifecycle-fault stress sample: ignores the $PORT env var and
listens on a hardcoded wrong port, so the arena can never reach /health and
the match is forfeited for startup_timeout once the 30s grace expires."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    # Deliberately NOT os.environ["PORT"] -- the arena will never find this.
    ThreadingHTTPServer(("0.0.0.0", 9), Handler).serve_forever()
