"""
Outbound URL validation — blocks SSRF via metadata endpoints, link-local
IPs, private networks, and non-http schemes. Applied to both user-supplied
endpoints at registration time AND to the scheduled health check before it
actually fires, to close a DNS-rebinding window.
"""

import ipaddress
import socket
from urllib.parse import urlparse


class UnsafeUrlError(ValueError):
    """Raised when a URL fails the SSRF allow-list checks."""


_BLOCKED_RANGES = [
    ipaddress.ip_network(n) for n in [
        # IPv4 loopback + private + link-local + test + multicast + reserved
        "127.0.0.0/8",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "169.254.0.0/16",     # link-local (AWS/GCP metadata lives at 169.254.169.254)
        "100.64.0.0/10",      # carrier-grade NAT
        "192.0.0.0/24",
        "192.0.2.0/24",
        "198.18.0.0/15",
        "198.51.100.0/24",
        "203.0.113.0/24",
        "224.0.0.0/4",        # multicast
        "240.0.0.0/4",        # reserved
        # IPv6
        "::1/128",            # loopback
        "fc00::/7",           # unique local
        "fe80::/10",          # link-local
        "fec0::/10",          # deprecated site-local
    ]
]

_ALLOWED_SCHEMES = {"http", "https"}


def validate_outbound_url(url: str) -> None:
    """
    Validate that `url` points to a public internet destination.

    Rejects:
      - schemes other than http/https (file://, gopher://, ldap://, ...)
      - missing or empty hostname
      - hostnames that resolve to private, loopback, link-local, multicast,
        or reserved IP ranges

    Raises UnsafeUrlError on rejection. Returns None on success.
    """
    if not url:
        raise UnsafeUrlError("URL is empty")

    parsed = urlparse(url)
    if parsed.scheme.lower() not in _ALLOWED_SCHEMES:
        raise UnsafeUrlError(
            f"Scheme '{parsed.scheme}' not allowed; use http or https"
        )

    hostname = parsed.hostname
    if not hostname:
        raise UnsafeUrlError("URL is missing a hostname")

    # Resolve the hostname to all of its addresses. Any blocked range in the
    # resolution set is rejected — defends against DNS records that mix
    # public and private addresses.
    try:
        addrinfo = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise UnsafeUrlError(f"Hostname does not resolve: {hostname}") from exc

    resolved = {info[4][0] for info in addrinfo}
    for addr in resolved:
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            raise UnsafeUrlError(f"Unrecognised IP from resolution: {addr}")
        if any(ip in net for net in _BLOCKED_RANGES):
            raise UnsafeUrlError(
                f"Hostname '{hostname}' resolves to blocked range ({ip})"
            )
