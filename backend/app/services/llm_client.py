"""
LLM REST Wrapper — llm/client.py

ALL LLM calls go through this module. No route handler ever
touches the Anthropic SDK directly. This makes it easy to:
  1. Swap providers (Anthropic → OpenAI → Ollama) by changing ONE file
  2. Add logging, rate limiting, or caching in one place
  3. Mock for testing

Functions:
  - test_connection()       → Used by Module 1 (Service Registry)
  - run_eval_prompt()       → Used by Module 2 (Evaluation Harness)
  - generate_summary()      → Used by Module 3 (Incident Triage)
"""

import time
import anthropic
from app.config import get_settings

settings = get_settings()

# Initialize the Anthropic client once
_client = None


def _get_client() -> anthropic.Anthropic:
    """Lazy-initialize the Anthropic client."""
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return _client


async def test_connection(prompt: str = "Say hello in exactly 5 words.") -> dict:
    """
    Module 1: Test Connection
    Sends a small prompt to Claude and measures latency.
    Returns: { status, latency_ms, response_snippet }
    """
    client = _get_client()
    start = time.time()

    try:
        response = client.messages.create(
            model=settings.llm_model,
            max_tokens=50,
            messages=[{"role": "user", "content": prompt}],
        )
        latency_ms = round((time.time() - start) * 1000, 1)
        snippet = response.content[0].text[:200] if response.content else ""

        return {
            "status": "success",
            "latency_ms": latency_ms,
            "response_snippet": snippet,
        }
    except Exception as e:
        latency_ms = round((time.time() - start) * 1000, 1)
        return {
            "status": "failure",
            "latency_ms": latency_ms,
            "response_snippet": str(e)[:200],
        }


async def run_eval_prompt(prompt: str, system_context: str = "") -> dict:
    """
    Module 2: Evaluation Harness
    Sends an eval test case prompt and returns the raw response.
    The scoring logic lives in the evaluation router, not here.
    Returns: { response_text, latency_ms }
    """
    client = _get_client()
    start = time.time()

    try:
        messages = [{"role": "user", "content": prompt}]
        kwargs = {
            "model": settings.llm_model,
            "max_tokens": settings.llm_max_tokens,
            "messages": messages,
        }
        if system_context:
            kwargs["system"] = system_context

        response = client.messages.create(**kwargs)
        latency_ms = round((time.time() - start) * 1000, 1)
        text = response.content[0].text if response.content else ""

        return {"response_text": text, "latency_ms": latency_ms}
    except Exception as e:
        latency_ms = round((time.time() - start) * 1000, 1)
        return {"response_text": f"ERROR: {str(e)}", "latency_ms": latency_ms}


async def generate_summary(
    service_name: str,
    severity: str,
    symptoms: str,
    checklist: dict,
) -> dict:
    """
    Module 3: Incident Triage — LLM-assisted summary
    Drafts a stakeholder update + root cause suggestions.
    *** Returns the DRAFT only — human must approve before saving ***
    Returns: { summary_draft, root_causes_draft }
    """
    client = _get_client()

    checklist_text = "\n".join(
        f"- {k}: {'Yes' if v else 'No'}" for k, v in checklist.items()
    )

    prompt = f"""You are an AI operations assistant. An incident has been reported.

Service: {service_name}
Severity: {severity}
Symptoms: {symptoms}

Troubleshooting checklist results:
{checklist_text}

Please provide:
1. A brief stakeholder update (2-3 sentences suitable for management)
2. Top 3 most likely root causes based on the symptoms and checklist

Format your response as:
STAKEHOLDER UPDATE:
[your update here]

ROOT CAUSES:
1. [cause 1]
2. [cause 2]
3. [cause 3]"""

    try:
        response = client.messages.create(
            model=settings.llm_model,
            max_tokens=settings.llm_max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text if response.content else ""

        # Parse the response into sections
        summary_draft = text
        root_causes_draft = ""

        if "ROOT CAUSES:" in text:
            parts = text.split("ROOT CAUSES:")
            summary_draft = parts[0].replace("STAKEHOLDER UPDATE:", "").strip()
            root_causes_draft = parts[1].strip()

        return {
            "summary_draft": summary_draft,
            "root_causes_draft": root_causes_draft,
        }
    except Exception as e:
        return {
            "summary_draft": f"Error generating summary: {str(e)}",
            "root_causes_draft": "",
        }
