"""
Supported Anthropic models — the system's single source of truth.

Every place that needs to know "what models do we support?" (the
/settings/models/catalog endpoint feeding the Service Registry
dropdown, the cost estimator in llm_client, the /dashboard/settings
card on the Models tab) reads from CATALOG below.

Design choices
  - Keys are the family-tier form ("claude-sonnet-4-6"), NOT the dated
    snapshot form ("claude-sonnet-4-6-20250415"). Anthropic ships both
    forms; dated ones point at a specific snapshot, undated at "latest
    within family". Pricing is the same either way, so we normalize
    lookups by stripping the -YYYYMMDD suffix.
  - `recommended_for` is a hint shown in the dropdown label, not a
    constraint. An admin can still pick Sonnet-as-judge if they want
    — the UI just nudges them toward the cheaper Haiku.
  - When Anthropic ships a new model, adding one line here is all it
    takes: the catalog endpoint, dropdown, and pricing lookup all
    read from this file.
"""

import re
from dataclasses import dataclass
from typing import Literal, Optional


# Anthropic's dated model IDs always end in "-YYYYMMDD". Strip it before
# pricing lookup so claude-sonnet-4-6 and claude-sonnet-4-6-20250415
# resolve to the same catalog entry.
_DATE_SUFFIX_RE = re.compile(r"-\d{8}$")


@dataclass(frozen=True)
class ModelInfo:
    id: str                                      # catalog key (no date suffix)
    family: str                                  # "sonnet" | "haiku"
    tier: str                                    # "4.6", "4.5", etc.
    label: str                                   # "Sonnet 4.6" (human-facing)
    recommended_for: Literal["actor", "judge"]
    input_per_million_usd: float
    output_per_million_usd: float


# Ordered actor-first so the dropdown shows the likely default at the top.
CATALOG: list[ModelInfo] = [
    ModelInfo(
        id="claude-sonnet-4-6", family="sonnet", tier="4.6", label="Sonnet 4.6",
        recommended_for="actor",
        input_per_million_usd=3.0, output_per_million_usd=15.0,
    ),
    ModelInfo(
        id="claude-haiku-4-5", family="haiku", tier="4.5", label="Haiku 4.5",
        recommended_for="judge",
        input_per_million_usd=1.0, output_per_million_usd=5.0,
    ),
]

_BY_ID: dict[str, ModelInfo] = {m.id: m for m in CATALOG}

# Sonnet-rate fallback for models not in the catalog. Deliberately a SAFE
# OVER-estimate: if we don't know the model, we'd rather charge the
# budget too much than too little. The unknown-model warning in
# llm_client logs the first occurrence so devs get told.
_FALLBACK = ModelInfo(
    id="_fallback", family="unknown", tier="unknown", label="Unknown",
    recommended_for="actor",
    input_per_million_usd=3.0, output_per_million_usd=15.0,
)


def normalize_model_id(model: str) -> str:
    """Strip the optional -YYYYMMDD date snapshot suffix Anthropic appends
    to versioned model IDs. Idempotent: bare ids pass through unchanged."""
    return _DATE_SUFFIX_RE.sub("", model or "")


def find_model(model: str) -> Optional[ModelInfo]:
    """Return the catalog entry for a model (normalized lookup), or None
    if the id isn't a known family-tier. Callers use this to detect an
    out-of-catalog model and decide whether to warn or reject."""
    return _BY_ID.get(normalize_model_id(model))


def pricing_for(model: str) -> tuple[float, float]:
    """Return (input_per_million_usd, output_per_million_usd) for a model,
    with normalization + Sonnet-rate fallback for unknown models.

    This is the ONLY function the cost estimator should call — don't
    touch _BY_ID or CATALOG directly for pricing, so the fallback +
    normalization logic can't get bypassed."""
    info = find_model(model) or _FALLBACK
    return info.input_per_million_usd, info.output_per_million_usd
