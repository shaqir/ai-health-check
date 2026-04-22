"""
Semantic family mapping for LLM callers.

The api_usage_log.caller column stores the low-level function name
("run_eval_prompt", "judge_response", "generate_summary", ...). That's
useful for cost attribution and debugging, but reviewers in the Settings
→ Call Trace view want human-friendly categories: "Evaluation",
"Incident triage", "Dashboard insight".

This module is the ONE place that maps caller → family. Both trace
endpoints read from it so the mapping stays consistent.
"""

from typing import Literal


Family = Literal[
    "connection_test",
    "evaluation",
    "incident_triage",
    "dashboard_insight",
    "compliance_report",
    "other",
]


# caller (function name in llm_client.py) → family (user-facing category)
_FAMILY_BY_CALLER: dict[str, Family] = {
    "test_connection":              "connection_test",
    "run_eval_prompt":              "evaluation",
    "judge_response":               "evaluation",
    "generate_summary":             "incident_triage",
    "generate_dashboard_insight":   "dashboard_insight",
    "generate_compliance_summary":  "compliance_report",
}


# Human-readable labels for the UI. Kept backend-side so the backend
# can assemble list rows without hard-coding strings in multiple places.
FAMILY_LABELS: dict[Family, str] = {
    "connection_test":   "Connection test",
    "evaluation":        "Evaluation run",
    "incident_triage":   "Incident triage",
    "dashboard_insight": "Dashboard insight",
    "compliance_report": "Compliance report",
    "other":             "Other",
}


def family_for_caller(caller: str) -> Family:
    """Map a caller to a family. Unknown callers return 'other' — this
    lets new LLM functions land without breaking the trace view; they
    just show up as 'Other' until the map is updated."""
    return _FAMILY_BY_CALLER.get(caller, "other")
