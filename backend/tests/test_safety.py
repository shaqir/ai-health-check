"""Tests for prompt safety redaction."""

from app.services.safety import redact_sensitive_text, scan_input, scan_output


def test_scan_input_redacts_phi_and_pii_with_placeholders():
    text = (
        "Patient Name: John Smith DOB: 03/15/1985 "
        "SSN 123-45-6789 email john.smith@example.com MRN A12345"
    )

    result = scan_input(text)

    assert result["safe"] is True
    assert "pii_detected" in result["flags"]
    assert "phi_redacted" in result["flags"]
    redacted = result["redacted_text"]
    assert "[PATIENT_NAME]" in redacted
    assert "[DOB]" in redacted
    assert "[SSN]" in redacted
    assert "[EMAIL]" in redacted
    assert "[MRN]" in redacted
    assert "John Smith" not in redacted
    assert "123-45-6789" not in redacted
    assert "john.smith@example.com" not in redacted


def test_redact_sensitive_text_preserves_non_sensitive_text():
    redacted, counts = redact_sensitive_text("No identifiers in this prompt.")

    assert redacted == "No identifiers in this prompt."
    assert counts == {}


def test_scan_output_reports_and_redacts_sensitive_response_text():
    result = scan_output("Call patient at 403-555-1212. DOB: March 15, 1985.")

    assert "output_pii_phone" in result["flags"]
    assert "output_phi_dob" in result["flags"]
    assert "output_phi_redacted" in result["flags"]
    assert "[PHONE]" in result["redacted_text"]
    assert "[DOB]" in result["redacted_text"]
    assert "403-555-1212" not in result["redacted_text"]
