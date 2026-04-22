"""
Startup hygiene — SECRET_KEY validator refuses unset / default / weak
values so a forgotten .env can't silently start the server with a
signing key anyone who read .env.example can forge against.

Tests the validator helper directly rather than spinning up the full
lifespan — the contract is what matters and it keeps the tests cheap.
"""

import pytest

from app.main import _validate_secret_key


def test_validator_rejects_empty_string():
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        _validate_secret_key("")


def test_validator_rejects_config_default():
    """The literal default from config.py must be refused."""
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        _validate_secret_key("change-me-in-production")


def test_validator_rejects_env_example_placeholder():
    """The literal placeholder committed to .env.example must be refused.

    This is the one that actually bites in practice: developers copy
    .env.example to .env without reading the inline instructions.
    """
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        _validate_secret_key(
            "change-this-to-a-random-string-at-least-32-chars"
        )


def test_validator_rejects_short_key():
    """Anything under 32 chars is refused even if non-default."""
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        _validate_secret_key("short-but-not-default")


def test_validator_accepts_strong_key():
    """A 32+ char non-default string passes — this is the happy path."""
    # A `secrets.token_urlsafe(32)` output is 43 chars, well over 32.
    _validate_secret_key("a-sufficiently-long-and-non-default-secret-key-value-123")
