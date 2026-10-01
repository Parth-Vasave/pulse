"""HTTP client that cannot be tricked into reaching internal networks.

The guard lives in the network backend, i.e. at TCP-connect time: the hostname is
resolved once, every address is validated, and we connect to that validated IP.
TLS SNI / certificate verification still use the original hostname.
"""

import httpcore
import httpx

from app.services.ssrf import Resolver, resolve_and_validate, system_resolver


class GuardedBackend(httpcore.SyncBackend):
    def __init__(self, resolver: Resolver = system_resolver) -> None:
        super().__init__()
        self._resolver = resolver

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):  # type: ignore[no-untyped-def]
        addresses = resolve_and_validate(host, port, self._resolver)
        last_exc: Exception | None = None
        for address in addresses:
            try:
                return super().connect_tcp(address, port, timeout, local_address, socket_options)
            except httpcore.ConnectError as exc:
                last_exc = exc
        assert last_exc is not None
        raise last_exc


def build_guarded_client(timeout_seconds: float, resolver: Resolver = system_resolver) -> httpx.Client:
    transport = httpx.HTTPTransport(retries=0)
    transport._pool._network_backend = GuardedBackend(resolver)  # type: ignore[attr-defined]
    return httpx.Client(
        transport=transport,
        timeout=httpx.Timeout(timeout_seconds),
        follow_redirects=False,  # a redirect could point at an internal address
        trust_env=False,  # ignore proxy env vars
    )
