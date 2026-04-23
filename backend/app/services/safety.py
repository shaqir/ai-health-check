"""
Prompt Safety Scanner — safety.py

Scans LLM inputs and outputs for security risks:
  - Prompt injection detection
  - PII detection (emails, phone numbers, SSNs)
  - Length validation (prevent token exhaustion)
  - Input sanitization
  - Output safety flags
"""

import html
import re
from app.config import get_settings

settings = get_settings()

# ── Injection Patterns ──
# Common prompt injection phrases (case-insensitive matching)
_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"ignore\s+(all\s+)?prior\s+instructions",
    r"disregard\s+(all\s+)?(previous|prior|above)",
    r"forget\s+(all\s+)?(previous|prior|above)\s+(instructions|context)",
    r"forget\s+everything",
    r"you\s+are\s+now\s+(a|an|the)",
    r"new\s+instructions?\s*:",
    r"new\s+persona\s*:",
    r"updated\s+(system\s+)?(instructions|prompt)\s*:",
    r"system\s*prompt\s*:",
    r"(reveal|show|output|print|display|leak|expose)\s+(your\s+)?(system\s+)?(prompt|instructions)",
    r"(reveal|show|leak|expose)\s+(the\s+)?(api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|password)",
    r"what\s+(are|is)\s+your\s+(system\s+)?(prompt|instructions)",
    r"repeat\s+(all|your)\s+(system\s+)?(messages|prompts|instructions)",
    r"act\s+as\s+(if\s+)?(you\s+are|a|an)",
    r"pretend\s+(you\s+are|to\s+be)",
    r"roleplay\s+as",
    r"jailbreak",
    r"DAN\s+mode",
    r"developer\s+mode\s+(enabled|on|activated)",
]

_INJECTION_COMPILED = [re.compile(p, re.IGNORECASE) for p in _INJECTION_PATTERNS]

# ── PII Patterns ──
_SENSITIVE_PATTERNS = {
    "patient_name": {
        "pattern": re.compile(r"\b((?i:patient(?:\s+name)?))\s*[:=]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b"),
        "placeholder": "[PATIENT_NAME]",
        "family": "phi",
        "keep_label": True,
    },
    "dob": {
        "pattern": re.compile(
            r"\b(DOB|date\s+of\s+birth)\s*[:=]?\s*"
            r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|"
            r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b",
            re.IGNORECASE,
        ),
        "placeholder": "[DOB]",
        "family": "phi",
        "keep_label": True,
    },
    "ssn": {
        "pattern": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
        "placeholder": "[SSN]",
        "family": "pii",
    },
    "mrn": {
        "pattern": re.compile(r"\b(MRN|medical\s+record(?:\s+number)?)\s*[:=]?\s*[A-Z0-9-]{4,20}\b", re.IGNORECASE),
        "placeholder": "[MRN]",
        "family": "phi",
        "keep_label": True,
    },
    "email": {
        "pattern": re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"),
        "placeholder": "[EMAIL]",
        "family": "pii",
    },
    "phone": {
        "pattern": re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),
        "placeholder": "[PHONE]",
        "family": "pii",
    },
    "credit_card": {
        "pattern": re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b"),
        "placeholder": "[CREDIT_CARD]",
        "family": "pii",
    },
    "address": {
        "pattern": re.compile(
            r"\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+"
            r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way)\b",
            re.IGNORECASE,
        ),
        "placeholder": "[ADDRESS]",
        "family": "phi",
    },
}

_PII_PATTERNS = {
    key: spec["pattern"]
    for key, spec in _SENSITIVE_PATTERNS.items()
    if spec["family"] == "pii"
}


def redact_sensitive_text(text: str) -> tuple[str, dict[str, int]]:
    """Replace supported PII/PHI spans with deterministic placeholders."""
    if not text:
        return text, {}

    redacted = text
    counts: dict[str, int] = {}

    for kind, spec in _SENSITIVE_PATTERNS.items():
        pattern = spec["pattern"]
        matches = list(pattern.finditer(redacted))
        if not matches:
            continue

        counts[kind] = len(matches)
        placeholder = spec["placeholder"]

        if spec.get("keep_label"):
            def _replace_with_label(match, placeholder=placeholder):
                return f"{match.group(1)}: {placeholder}"

            redacted = pattern.sub(_replace_with_label, redacted)
        else:
            redacted = pattern.sub(placeholder, redacted)

    return redacted, counts

# ── Safety Constants ──
RISK_WEIGHT_INJECTION = 40  # per injection pattern match
RISK_WEIGHT_PII = 20       # per PII type found
RISK_WEIGHT_LENGTH = 15    # if prompt exceeds soft limit (80% of max)


class PromptSafetyError(Exception):
    """Raised when a prompt fails safety checks."""
    def __init__(self, message: str, flags: list[str], risk_score: int):
        super().__init__(message)
        self.flags = flags
        self.risk_score = risk_score


def scan_input(text: str) -> dict:
    """
    Single-layer regex tripwire for input safety. Checks length, known
    injection patterns, and PII. Fast, deterministic, observable in logs.

    Returns: {safe: bool, flags: list[str], risk_score: int (0-100), details: dict}
    """
    flags = []
    details = {}
    risk_score = 0

    if not text:
        return {"safe": True, "flags": [], "risk_score": 0, "details": {}, "redacted_text": text}

    # 1. Length check
    max_len = settings.max_prompt_length
    if len(text) > max_len:
        flags.append("length_exceeded")
        details["length"] = {"actual": len(text), "max": max_len}
        risk_score += 100  # auto-block
    elif len(text) > max_len * 0.8:
        flags.append("length_warning")
        details["length"] = {"actual": len(text), "max": max_len}
        risk_score += RISK_WEIGHT_LENGTH

    # 2. Injection tripwire
    injection_matches = []
    for pattern in _INJECTION_COMPILED:
        match = pattern.search(text)
        if match:
            injection_matches.append(match.group())

    if injection_matches:
        flags.append("injection_attempt")
        details["injection_matches"] = injection_matches[:5]  # cap at 5
        risk_score += RISK_WEIGHT_INJECTION * len(injection_matches)

    # 3. PII / PHI detection and redaction
    redacted_text, redactions = redact_sensitive_text(text)
    pii_found = {
        kind: count for kind, count in redactions.items()
        if _SENSITIVE_PATTERNS[kind]["family"] == "pii"
    }
    phi_found = {
        kind: count for kind, count in redactions.items()
        if _SENSITIVE_PATTERNS[kind]["family"] == "phi"
    }

    if redactions:
        flags.append("pii_detected")
        flags.append("phi_redacted")
        if pii_found:
            details["pii"] = pii_found
        if phi_found:
            details["phi"] = phi_found
        details["redactions"] = redactions
        # Redacted identifiers should raise visibility without blocking a
        # cleaned request by themselves; injection and hard length limits
        # still push the risk score over the blocking threshold.
        risk_score += min(RISK_WEIGHT_PII * len(redactions), 60)

    risk_score = min(risk_score, 100)

    return {
        "safe": risk_score < 80,
        "flags": flags,
        "risk_score": risk_score,
        "details": details,
        "redacted_text": redacted_text,
    }


def scan_output(text: str) -> dict:
    """
    Scan LLM output for safety concerns before returning to user.
    Returns: {safe: bool, flags: list[str], pii_detected: bool}
    """
    flags = []

    if not text:
        return {"safe": True, "flags": [], "pii_detected": False, "redacted_text": text, "redactions": {}}

    # 1. PII / PHI in response
    redacted_text, redactions = redact_sensitive_text(text)
    pii_found = False
    for kind in redactions:
        family = _SENSITIVE_PATTERNS[kind]["family"]
        if family == "pii":
            flags.append(f"output_pii_{kind}")
            pii_found = True
        else:
            flags.append(f"output_phi_{kind}")
    if redactions:
        flags.append("output_phi_redacted")

    # 2. Refusal detection (Claude refused the request)
    refusal_patterns = [
        r"I (?:cannot|can't|am unable to|won't|will not)",
        r"I'm not able to",
        r"I apologize,?\s+but\s+I\s+(?:cannot|can't)",
        r"as an AI",
    ]
    for pattern in refusal_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            flags.append("model_refusal")
            break

    # 3. Toxicity / content policy (inspired by Patronus AI / Lakera)
    toxicity_patterns = [
        r"\b(?:kill|murder|attack|destroy|bomb|weapon)\b.*\b(?:how|steps|instructions|guide)\b",
        r"\b(?:hate|inferior|subhuman)\b.*\b(?:race|gender|religion|ethnicity)\b",
        r"\b(?:illegal|illicit)\b.*\b(?:how to|instructions|steps to)\b",
    ]
    for pattern in toxicity_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            flags.append("toxicity_detected")
            break

    # 4. Error in response
    if text.strip().upper().startswith("ERROR:"):
        flags.append("error_response")

    return {
        "safe": "output_pii_ssn" not in flags and "output_pii_credit_card" not in flags and "toxicity_detected" not in flags,
        "flags": flags,
        "pii_detected": pii_found,
        "redacted_text": redacted_text,
        "redactions": redactions,
    }


def sanitize_text(text: str) -> str:
    """
    Sanitize user input text:
    - Strip control characters (except newlines/tabs)
    - Collapse excessive whitespace
    - HTML-encode angle brackets
    """
    if not text:
        return text

    # Remove control chars except \n, \r, \t
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)

    # Collapse 3+ consecutive newlines to 2
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Collapse 3+ spaces to single space
    text = re.sub(r" {3,}", " ", text)

    # HTML-encode angle brackets to prevent XSS
    text = text.replace("<", "&lt;").replace(">", "&gt;")

    return text.strip()
