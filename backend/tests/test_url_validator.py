"""
Unit tests for the SSRF guard. The actual resolution is mocked so tests
are deterministic and don't need network.
"""

import pytest
from unittest.mock import patch

from app.services.url_validator import UnsafeUrlError, validate_outbound_url


def _mock_resolve(ip_str):
    """Build a getaddrinfo-compatible return value that resolves to a single IP."""
    return [(2, 1, 6, "", (ip_str, 0))]


def test_rejects_metadata_service():
    with patch("socket.getaddrinfo", return_value=_mock_resolve("169.254.169.254")):
        with pytest.raises(UnsafeUrlError, match="blocked range"):
            validate_outbound_url("http://169.254.169.254/latest/meta-data/")


def test_rejects_loopback():
    with patch("socket.getaddrinfo", return_value=_mock_resolve("127.0.0.1")):
        with pytest.raises(UnsafeUrlError, match="blocked range"):
            validate_outbound_url("http://localhost:8000/admin")


def test_rejects_rfc1918():
    for addr in ("10.0.0.5", "172.16.1.1", "192.168.1.1"):
        with patch("socket.getaddrinfo", return_value=_mock_resolve(addr)):
            with pytest.raises(UnsafeUrlError):
                validate_outbound_url(f"http://{addr}/")


def test_rejects_non_http_scheme():
    with pytest.raises(UnsafeUrlError, match="Scheme"):
        validate_outbound_url("file:///etc/passwd")
    with pytest.raises(UnsafeUrlError, match="Scheme"):
        validate_outbound_url("gopher://evil/")


def test_rejects_missing_hostname():
    with pytest.raises(UnsafeUrlError, match="hostname"):
        validate_outbound_url("http://")


def test_rejects_unresolvable_host():
    import socket
    with patch("socket.getaddrinfo", side_effect=socket.gaierror("no resolve")):
        with pytest.raises(UnsafeUrlError, match="does not resolve"):
            validate_outbound_url("http://nope.invalid/")


def test_allows_public_ip():
    with patch("socket.getaddrinfo", return_value=_mock_resolve("1.1.1.1")):
        # Should not raise
        validate_outbound_url("https://example.com/health")


def test_rejects_ipv6_loopback():
    with patch("socket.getaddrinfo", return_value=_mock_resolve("::1")):
        with pytest.raises(UnsafeUrlError, match="blocked range"):
            validate_outbound_url("http://[::1]/")


def test_rejects_mixed_resolution_with_private():
    """If DNS returns both a public AND private IP, reject — belt and braces."""
    addrinfo = [
        (2, 1, 6, "", ("1.1.1.1", 0)),
        (2, 1, 6, "", ("10.0.0.1", 0)),
    ]
    with patch("socket.getaddrinfo", return_value=addrinfo):
        with pytest.raises(UnsafeUrlError):
            validate_outbound_url("http://mixed.example.com/")


def test_empty_url_rejected():
    with pytest.raises(UnsafeUrlError, match="empty"):
        validate_outbound_url("")
