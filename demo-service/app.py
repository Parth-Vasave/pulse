"""Tiny target API for demos and tests (stdlib only).

  /healthy   always 200
  /error     always 500
  /slow      200 after SLOW_SECONDS (default 3)
  /flaky     fails ~50% of the time
  /switch    200 or 500 depending on state; flip it with POST /switch/fail and /switch/restore,
             or use the buttons at "/". This is the endpoint to monitor for the incident demo.
"""

import json
import os
import random
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "9000"))
SLOW_SECONDS = float(os.environ.get("SLOW_SECONDS", "3"))
state = {"failing": False}

PAGE = """<!doctype html><meta charset=utf-8><title>Demo target API</title>
<style>body{font:16px system-ui;max-width:560px;margin:3rem auto;padding:0 1rem}
button{font:inherit;padding:.5rem 1rem;margin-right:.5rem;cursor:pointer}code{background:#eee;padding:.1rem .3rem}</style>
<h1>Demo target API</h1><p>/switch is currently <strong id=s>…</strong></p>
<button onclick="f('fail')">Make it fail</button><button onclick="f('restore')">Restore</button>
<p>Endpoints: <code>/healthy</code> <code>/slow</code> <code>/error</code> <code>/flaky</code> <code>/switch</code></p>
<script>async function r(){const j=await (await fetch('/switch/state')).json();s.textContent=j.failing?'FAILING (500)':'healthy (200)'}
async function f(a){await fetch('/switch/'+a,{method:'POST'});r()}r()</script>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, status: int, payload: dict | str, ctype: str = "application/json") -> None:
        body = (payload if isinstance(payload, str) else json.dumps(payload)).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/":
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif path == "/healthy":
            self._send(200, {"status": "healthy", "database": "connected"})
        elif path == "/error":
            self._send(500, {"status": "error"})
        elif path == "/slow":
            time.sleep(SLOW_SECONDS)
            self._send(200, {"status": "healthy", "slow": True})
        elif path == "/flaky":
            ok = random.random() < 0.5  # noqa: S311
            self._send(200 if ok else 500, {"status": "healthy" if ok else "error"})
        elif path == "/switch":
            failing = state["failing"]
            self._send(500 if failing else 200, {"status": "error" if failing else "healthy"})
        elif path == "/switch/state":
            self._send(200, state)
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/switch/fail":
            state["failing"] = True
        elif self.path == "/switch/restore":
            state["failing"] = False
        else:
            self._send(404, {"error": "not found"})
            return
        self._send(200, state)


if __name__ == "__main__":
    print(f"demo service on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104
