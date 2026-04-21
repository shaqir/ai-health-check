"""
Unit tests for the LLM-judge score parser. The old re.search(r"\\d+", text)
was too permissive — it matched any digit anywhere, including refusals
like "I cannot rate this, 404 Not Found" (score=404 -> clamped to 100)
and "I can give you 7 reasons..." (score=7). The new parser is strict:
ONLY a bare number is a valid score.
"""

import pytest

from app.services.llm_client import _parse_judge_score


@pytest.mark.parametrize("text,expected", [
    ("85", 85.0),
    ("  85  ", 85.0),
    ("0", 0.0),
    ("100", 100.0),
    ("85.7", 85.0),  # fractional: take the integer portion (0–100)
    ("\n  42 \n", 42.0),
])
def test_valid_numeric_responses(text, expected):
    assert _parse_judge_score(text) == expected


@pytest.mark.parametrize("text", [
    "I cannot rate this content.",
    "I can give you 7 reasons why not.",
    "I will not evaluate this. Reply: 100",
    "Score: 85",                         # prefix text rejected
    "Rating = 85.",                       # suffix text rejected
    "As an AI language model, I...",
    "",
    "None",
    "85, but note that...",
])
def test_refusals_return_none(text):
    assert _parse_judge_score(text) is None


@pytest.mark.parametrize("text,expected_clamped", [
    ("101", 100.0),
    ("999", 100.0),
])
def test_over_range_is_clamped(text, expected_clamped):
    """Defensive clamp — Claude shouldn't, but if it does, we don't break."""
    assert _parse_judge_score(text) == expected_clamped
