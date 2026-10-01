"""SSRF protection for user-supplied monitor targets.

Defence in depth:
  1. `validate_url` at monitor create/update time (fast feedback to the user).
  2. `GuardedBackend` at connect time: every TCP connection the checker opens
     re-resolves the hostname, validates *every* returned address, and connects
     to the validated IP itself. That closes the DNS-rebinding window between
     validation and use (TOCTOU) - there is no second, unvalidated lookup.
Redirects are never followed by the checker, so a public host cannot bounce us
to an internal one.
"""

import contextlib
import ipaddress
import socket
from collections.abc import Callable
from urllib.parse import urlsplit

from app.core.config import get_settings

ALLOWED_SCHEMES = {"http", "https"}
_BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal", "metadata", "instance-data"}
_BLOCKED_SUFFIXES = (".localhost", ".internal", ".local", ".localdomain")
_EXTRA_BLOCKED_NETS = [
    ipaddress.ip_network("100.64.0.0/10"),  # carrier-grade NAT
    ipaddress.ip_network("169.254.0.0/16"),  # link-local incl. cloud metadata 169.254.169.254
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("198.18.0.0/15"),
]

Resolver = Callable[[str, int], list[str]]


class SSRFError(ValueError):
    """Target is not permitted."""


def is_blocked_ip(ip: str | ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    addr = ipaddress.ip_address(ip) if isinstance(ip, str) else ip
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped:  # ::ffff:127.0.0.1 must not bypass the IPv4 rules
            return is_blocked_ip(addr.ipv4_mapped)
        if addr.sixtofour:
            return is_blocked_ip(addr.sixtofour)
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
        or any(addr in net for net in _EXTRA_BLOCKED_NETS if net.version == addr.version)
    )


def system_resolver(host: str, port: int) -> list[str]:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


def _is_allowlisted(host: str) -> bool:
    return host.lower() in get_settings().ssrf_allowed_host_set


def check_hostname(host: str) -> None:
    h = host.lower().rstrip(".")
    if h in _BLOCKED_HOSTNAMES or h.endswith(_BLOCKED_SUFFIXES):
        raise SSRFError(f"Host '{host}' is not allowed")


def resolve_and_validate(host: str, port: int, resolver: Resolver | None = None) -> list[str]:
    """Resolve `host` and return its addresses, raising if ANY is disallowed."""
    resolver = resolver or system_resolver
    if _is_allowlisted(host):
        return resolver(host, port)
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        if is_blocked_ip(literal):
            raise SSRFError("Target address is not allowed")
        return [str(literal)]
    check_hostname(host)
    addresses = resolver(host, port)
    if not addresses:
        raise SSRFError("Host did not resolve")
    for address in addresses:
        if is_blocked_ip(address):
            raise SSRFError("Host resolves to a disallowed address")
    return addresses


def validate_url(url: str, resolver: Resolver | None = None) -> str:
    """Validate a monitor URL. Unresolvable hosts pass (DNS may be fixed later); the
    connect-time guard still protects the actual request."""
    parts = urlsplit(url)
    if parts.scheme not in ALLOWED_SCHEMES:
        raise SSRFError("Only http and https URLs are allowed")
    if not parts.hostname:
        raise SSRFError("URL must include a host")
    if parts.username or parts.password:
        raise SSRFError("Credentials in URLs are not allowed")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    with contextlib.suppress(socket.gaierror):
        resolve_and_validate(parts.hostname, port, resolver)
    return url
