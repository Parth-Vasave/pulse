import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.core.config import get_settings
from tests.conftest import DNS_OVERRIDES


class Target:
    """A real local HTTP server whose behaviour tests can flip at runtime."""

    def __init__(self) -> None:
        self.healthy = True
        self.requests: list[tuple[str, str, bytes]] = []  # (method, path, body)
        self.webhook_status = 200
        target = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):  # silence
                pass

            def _handle(self):
                length = int(self.headers.get("content-length") or 0)
                body = self.rfile.read(length) if length else b""
                target.requests.append((self.command, self.path, body))
                if self.path == "/slow":
                    time.sleep(2)
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "http://127.0.0.1:1/internal")
                    self.end_headers()
                    return
                if self.path == "/hook":
                    self.send_response(target.webhook_status)
                    self.end_headers()
                    return
                status = 200 if target.healthy else 500
                payload = json.dumps({"status": "healthy" if target.healthy else "broken"}).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _handle

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def base(self) -> str:
        return f"http://target.test:{self.port}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def target(monkeypatch):
    t = Target()
    DNS_OVERRIDES["target.test"] = ["127.0.0.1"]
    monkeypatch.setattr(get_settings(), "ssrf_allowed_hosts", "target.test")
    yield t
    t.close()
