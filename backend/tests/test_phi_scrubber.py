"""
Tests for the PHI/PII scrubber — MVP scope row 6.

The project plan table 2.1 row 6 requires: "Detect and redact PHI before
sending to cloud APIs." These tests assert the redact half of that
requirement: after scrub_text / scrub_messages runs, no PII pattern
survives in the outgoing payload, and the counts surfaced to the audit
layer are accurate.
"""

from app.services.safety import (
    _PII_PATTERNS,
    scrub_messages,
    scrub_text,
)


def test_scrub_text_empty_returns_unchanged():
    r = scrub_text("")
    assert r == {"text": "", "counts": {}, "scrubbed": False}


def test_scrub_text_no_phi_passthrough():
    r = scrub_text("The quick brown fox jumps over the lazy dog.")
    assert r["scrubbed"] is False
    assert r["counts"] == {}
    assert r["text"] == "The quick brown fox jumps over the lazy dog."


def test_scrub_text_email_redacted():
    r = scrub_text("Contact me at bob@hospital.com please")
    assert "bob@hospital.com" not in r["text"]
    assert "[EMAIL]" in r["text"]
    assert r["counts"] == {"email": 1}


def test_scrub_text_phone_with_parens_fully_redacted():
    # Pre-existing regex lost the opening paren. Guard regression.
    r = scrub_text("Call (403) 555-1234 today")
    assert "403" not in r["text"]
    assert "555" not in r["text"]
    assert "[PHONE]" in r["text"]
    assert r["counts"] == {"phone": 1}


def test_scrub_text_ssn_redacted():
    r = scrub_text("SSN 123-45-6789 on file")
    assert "123-45-6789" not in r["text"]
    assert r["counts"] == {"ssn": 1}


def test_scrub_text_credit_card_redacted():
    r = scrub_text("Card 4111-1111-1111-1111 expires soon")
    assert "4111" not in r["text"]
    assert r["counts"] == {"credit_card": 1}


def test_scrub_text_mrn_redacted():
    r = scrub_text("Patient MRN: 48291 admitted")
    assert "48291" not in r["text"]
    assert r["counts"] == {"mrn": 1}


def test_scrub_text_dob_multiple_formats():
    cases = [
        "DOB March 15, 1985",
        "born 15 March 1985",
        "dob 03/15/1985",
        "birth 1985-03-15",
    ]
    for c in cases:
        r = scrub_text(c)
        assert r["counts"].get("dob") == 1, f"failed to scrub DOB in: {c!r}"
        assert "1985" not in r["text"], f"year survived in: {c!r} → {r['text']!r}"


def test_scrub_text_icd10_redacted():
    r = scrub_text("Diagnosis: A09 and also E11.9")
    # Both codes should be redacted.
    assert "A09" not in r["text"]
    assert "E11.9" not in r["text"]
    assert r["counts"].get("icd10") == 2


def test_scrub_text_bare_year_is_not_dob():
    # Regression guard: plain 4-digit year must not count as DOB.
    r = scrub_text("In 2026 we shipped AGAM.")
    assert "dob" not in r["counts"]
    assert r["text"] == "In 2026 we shipped AGAM."


def test_scrub_text_composite():
    raw = (
        "Patient John emailed bob@hospital.com from (403) 555-1234 "
        "re: MRN: 48291, SSN 123-45-6789, DOB March 15, 1985, dx A09"
    )
    r = scrub_text(raw)
    # Every raw value must be gone.
    for needle in ["bob@hospital.com", "403", "555", "48291",
                   "123-45-6789", "1985", "A09"]:
        assert needle not in r["text"], f"{needle!r} survived scrub"
    # Counts surface to audit correctly.
    assert r["counts"] == {
        "email": 1, "phone": 1, "mrn": 1,
        "ssn": 1, "dob": 1, "icd10": 1,
    }


def test_scrub_messages_preserves_role_and_scrubs_content():
    msgs = [
        {"role": "system", "content": "Be helpful."},
        {"role": "user", "content": "my email is a@b.com"},
    ]
    r = scrub_messages(msgs)
    assert r["scrubbed"] is True
    assert r["counts"] == {"email": 1}
    assert r["messages"][0] == {"role": "system", "content": "Be helpful."}
    assert r["messages"][1]["role"] == "user"
    assert "a@b.com" not in r["messages"][1]["content"]
    assert "[EMAIL]" in r["messages"][1]["content"]


def test_scrub_messages_multimodal_passthrough():
    # Non-string content (list of blocks) must pass through unchanged
    # rather than be coerced — silently corrupting structure would break
    # downstream Anthropic calls.
    msgs = [{"role": "user", "content": [{"type": "image", "source": {}}]}]
    r = scrub_messages(msgs)
    assert r["scrubbed"] is False
    assert r["messages"] == msgs


def test_scrub_messages_empty_list():
    r = scrub_messages([])
    assert r == {"messages": [], "counts": {}, "scrubbed": False}


def test_all_patterns_have_labels():
    # Guardrail: every detection pattern has a scrub label. If someone
    # adds a pattern later without a label, scrub_text would KeyError.
    from app.services.safety import _SCRUB_LABELS
    missing = set(_PII_PATTERNS) - set(_SCRUB_LABELS)
    assert not missing, f"patterns missing scrub labels: {missing}"
