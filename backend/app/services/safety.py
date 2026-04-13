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
    r"you\s+are\s+now\s+(a|an|the)",
    r"new\s+instructions?\s*:",
    r"system\s*prompt\s*:",
    r"(reveal|show|output|print|display)\s+(your\s+)?(system\s+)?(prompt|instructions)",
    r"what\s+(are|is)\s+your\s+(system\s+)?(prompt|instructions)",
    r"repeat\s+(all|your)\s+(system\s+)?(messages|prompts|instructions)",
    r"act\s+as\s+(if\s+)?(you\s+are|a|an)",
    r"pretend\s+(you\s+are|to\s+be)",
    r"jailbreak",
    r"DAN\s+mode",
    r"developer\s+mode\s+(enabled|on|activated)",
]

_INJECTION_COMPILED = [re.compile(p, re.IGNORECASE) for p in _INJECTION_PATTERNS]

# ── PII Patterns ──
_PII_PATTERNS = {
    "email": re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"),
    "phone": re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),
    "ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "credit_card": re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b"),
}

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
    Scan input text for safety risks before sending to Claude.
    Returns: {safe: bool, flags: list[str], risk_score: int (0-100), details: dict}
    """
    flags = []
    details = {}
    risk_score = 0

    if not text:
        return {"safe": True, "flags": [], "risk_score": 0, "details": {}}

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

    # 2. Injection detection
    injection_matches = []
    for pattern in _INJECTION_COMPILED:
        match = pattern.search(text)
        if match:
            injection_matches.append(match.group())

    if injection_matches:
        flags.append("injection_attempt")
        details["injection_matches"] = injection_matches[:5]  # cap at 5
        risk_score += RISK_WEIGHT_INJECTION * len(injection_matches)

    # 3. PII detection
    pii_found = {}
    for pii_type, pattern in _PII_PATTERNS.items():
        matches = pattern.findall(text)
        if matches:
            pii_found[pii_type] = len(matches)

    if pii_found:
        flags.append("pii_detected")
        details["pii"] = pii_found
        risk_score += RISK_WEIGHT_PII * len(pii_found)

    risk_score = min(risk_score, 100)

    return {
        "safe": risk_score < 80,
        "flags": flags,
        "risk_score": risk_score,
        "details": details,
    }


def scan_output(text: str) -> dict:
    """
    Scan LLM output for safety concerns before returning to user.
    Returns: {safe: bool, flags: list[str], pii_detected: bool}
    """
    flags = []

    if not text:
        return {"safe": True, "flags": [], "pii_detected": False}

    # 1. PII in response
    pii_found = False
    for pii_type, pattern in _PII_PATTERNS.items():
        if pattern.search(text):
            flags.append(f"output_pii_{pii_type}")
            pii_found = True

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

    # 3. Error in response
    if text.strip().upper().startswith("ERROR:"):
        flags.append("error_response")

    return {
        "safe": "output_pii_ssn" not in flags and "output_pii_credit_card" not in flags,
        "flags": flags,
        "pii_detected": pii_found,
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
