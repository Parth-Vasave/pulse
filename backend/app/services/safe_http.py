"""HTTP client that cannot be tricked into reaching internal networks, or held open past its timeout.

The guard lives in the network backend, i.e. at TCP-connect time: the hostname is
resolved once, every address is validated, and we connect to that validated IP.
TLS SNI / certificate verification still use the original hostname.

httpx timeouts apply to each socket operation, so a server that trickles a byte just inside the
timeout could hold a request open indefinitely. The backend therefore also enforces one deadline
for the whole client: every connect, read and write waits at most until it, then times out.
"""

import time

import httpcore
import httpx

from app.services.ssrf import Resolver, resolve_and_validate

_WRITE_CHUNK = 4096  # small enough that each chunk is one send(), so its wait is clamped to the deadline


class _Deadline:
    def __init__(self, seconds: float) -> None:
        self._at = time.monotonic() + seconds

    def clamp(self, timeout: float | None, expired: type[httpcore.TimeoutException]) -> float:
        """The timeout to use for the next socket operation; raises `expired` once the deadline has passed."""
        remaining = self._at - time.monotonic()
        if remaining <= 0:  # never hand the socket 0: that would make it non-blocking, not timed out
            raise expired("Request exceeded its overall timeout")
        return remaining if timeout is None else min(timeout, remaining)


class _DeadlineStream(httpcore.NetworkStream):
    def __init__(self, stream: httpcore.NetworkStream, deadline: _Deadline) -> None:
        self._stream = stream
        self._deadline = deadline

    def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        return self._stream.read(max_bytes, self._deadline.clamp(timeout, httpcore.ReadTimeout))

    def write(self, buffer: bytes, timeout: float | None = None) -> None:
        for i in range(0, len(buffer), _WRITE_CHUNK):
            self._stream.write(buffer[i : i + _WRITE_CHUNK], self._deadline.clamp(timeout, httpcore.WriteTimeout))

    def close(self) -> None:
        self._stream.close()

    def start_tls(self, ssl_context, server_hostname=None, timeout=None):  # type: ignore[no-untyped-def]
        timeout = self._deadline.clamp(timeout, httpcore.ConnectTimeout)
        return _DeadlineStream(self._stream.start_tls(ssl_context, server_hostname, timeout), self._deadline)

    def get_extra_info(self, info: str):  # type: ignore[no-untyped-def]
        return self._stream.get_extra_info(info)


class GuardedBackend(httpcore.SyncBackend):
    def __init__(self, resolver: Resolver | None, deadline: _Deadline) -> None:
        super().__init__()
        self._resolver = resolver
        self._deadline = deadline

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):  # type: ignore[no-untyped-def]
        addresses = resolve_and_validate(host, port, self._resolver)
        last_exc: Exception | None = None
        for address in addresses:
            timeout = self._deadline.clamp(timeout, httpcore.ConnectTimeout)
            try:
                stream = super().connect_tcp(address, port, timeout, local_address, socket_options)
            except httpcore.ConnectError as exc:
                last_exc = exc
                continue
            return _DeadlineStream(stream, self._deadline)
        assert last_exc is not None
        raise last_exc


def build_guarded_client(timeout_seconds: float, resolver: Resolver | None = None) -> httpx.Client:
    """`timeout_seconds` bounds everything the client does from now on (DNS resolution aside), not each step.

    Build a fresh client per request: the deadline starts when the client is built.
    """
    transport = httpx.HTTPTransport(retries=0)
    transport._pool._network_backend = GuardedBackend(resolver, _Deadline(timeout_seconds))  # type: ignore[attr-defined]
    return httpx.Client(
        transport=transport,
        timeout=httpx.Timeout(timeout_seconds),
        follow_redirects=False,  # a redirect could point at an internal address
        trust_env=False,  # ignore proxy env vars
    )
