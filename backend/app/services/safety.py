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

# ── PII / PHI Patterns ──
# Covers the MVP "Detect and redact PHI before sending to cloud APIs"
# requirement. Entries map 1:1 to the PHI types listed in the project
# plan §5.1 / Table 7 that can be matched with pure regex. Patient
# names and free-form addresses need NER (spaCy) — deferred to a
# future iteration; the rest of the table is covered here.
_PII_PATTERNS = {
    "email": re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"),
    # Lookarounds instead of \b so the pattern can consume the enclosing
    # parentheses in "(403) 555-1234" while still refusing to match the
    # middle of longer digit runs (e.g. a 16-digit account number).
    "phone": re.compile(r"(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)"),
    "ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "credit_card": re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b"),
    # Medical Record Number — "MRN: 48291" / "MRN 48291" / "MRN#48291"
    "mrn": re.compile(r"\bMRN\s*[:#]?\s*\d{4,10}\b", re.IGNORECASE),
    # Date of birth — matches "March 15, 1985", "15 March 1985", "03/15/1985",
    # "1985-03-15". Conservative: requires a 4-digit year so we don't scrub
    # short numeric strings that happen to look datelike.
    "dob": re.compile(
        r"\b("
        r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}"
        r"|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}"
        r"|\d{1,2}/\d{1,2}/\d{4}"
        r"|\d{4}-\d{2}-\d{2}"
        r")\b",
        re.IGNORECASE,
    ),
    # ICD-10 diagnosis codes — "A09", "E11.9", "ICD-10: A09". Letter + 2 digits
    # with optional decimal sub-code. Anchored to uppercase to avoid scrubbing
    # ordinary words that start with a capital letter followed by digits.
    "icd10": re.compile(r"\b(?:ICD-?10\s*[:#]?\s*)?[A-TV-Z][0-9]{2}(?:\.[0-9]{1,4})?\b"),
}

# Placeholder tokens used by scrub_text() when redacting. Kept visible and
# uppercase so a reviewer reading a scrubbed prompt in the audit log can
# immediately see where redaction happened. Must match what downstream
# consumers (Claude) can still reason about — "[EMAIL]" is clearer than "***".
_SCRUB_LABELS = {
    "email": "[EMAIL]",
    "phone": "[PHONE]",
    "ssn": "[SSN]",
    "credit_card": "[CREDIT_CARD]",
    "mrn": "[MRN]",
    "dob": "[DOB]",
    "icd10": "[ICD]",
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
    }


def scrub_text(text: str) -> dict:
    """
    Redact PII/PHI from a string before it leaves our backend.

    Replaces every match from _PII_PATTERNS with its placeholder label
    (e.g. "john@x.com" → "[EMAIL]"). Returns:
      {
        "text": scrubbed string,
        "counts": {pii_type: n, ...},  # non-zero entries only
        "scrubbed": bool,              # True if any replacement happened
      }

    The MVP scope table row 6 says "Detect and redact PHI **before
    sending to cloud APIs**" — this is the redact half. Callers in
    llm_client.py use this to sanitize prompts before forwarding to
    Anthropic so raw PHI never crosses the network boundary.

    Never log the original PHI. Log counts only (plan §5.2 step 3).
    """
    if not text:
        return {"text": text, "counts": {}, "scrubbed": False}

    counts: dict[str, int] = {}
    scrubbed = text
    for pii_type, pattern in _PII_PATTERNS.items():
        matches = pattern.findall(scrubbed)
        if not matches:
            continue
        counts[pii_type] = len(matches)
        scrubbed = pattern.sub(_SCRUB_LABELS[pii_type], scrubbed)

    return {
        "text": scrubbed,
        "counts": counts,
        "scrubbed": bool(counts),
    }


def scrub_messages(messages: list) -> dict:
    """
    Apply scrub_text to every 'content' field in a Claude messages list.

    Returns:
      {
        "messages": new list with redacted content,
        "counts": aggregated pii_type → n across all messages,
        "scrubbed": bool,
      }

    Preserves the original message structure (role, any extra keys) so
    the caller can drop the returned list straight into client.messages.create.
    """
    if not messages:
        return {"messages": messages, "counts": {}, "scrubbed": False}

    new_messages = []
    agg_counts: dict[str, int] = {}
    any_scrubbed = False

    for msg in messages:
        if not isinstance(msg, dict) or "content" not in msg:
            new_messages.append(msg)
            continue
        content = msg.get("content", "")
        if not isinstance(content, str):
            # Multimodal content (list of blocks) — out of scope for the
            # text-only MVP scrubber. Pass through untouched rather than
            # silently corrupting structure.
            new_messages.append(msg)
            continue
        result = scrub_text(content)
        if result["scrubbed"]:
            any_scrubbed = True
            for k, v in result["counts"].items():
                agg_counts[k] = agg_counts.get(k, 0) + v
        new_messages.append({**msg, "content": result["text"]})

    return {
        "messages": new_messages,
        "counts": agg_counts,
        "scrubbed": any_scrubbed,
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
