"""
Drift trend helper — single source of truth for the quality-score
trend classifier used by `eval_runner.run_service_evaluation` (when
deciding whether to promote a declining run to a drift alert) and by
`routers/evaluations.drift_check` + `drift-check`'s per-test-case
breakdown (for the UI trend arrow).

Before this extraction, the same split-half-mean logic lived twice
(once in eval_runner, once in evaluations.py), byte-identical. The
probe classifier M1 fixed by the same pattern (see commit 11b883b).

`routers/dashboard.py` has a DIFFERENT function also named
`_compute_trend` that returns "up"/"down"/"neutral" from a
percentage-change comparison (not a scores list). It's been renamed
to `_compute_pct_change_trend` in that module to eliminate the
naming collision; readers grepping `compute_*_trend` now see two
clearly-distinct helpers.
"""


def compute_quality_trend(scores: list[float]) -> str:
    """
    Classify a chronological list of quality scores as
    "improving" / "declining" / "stable" using a split-half mean.

    The algorithm splits the list at the midpoint, computes the mean
    of each half, and reports the direction of the difference. A
    diff > 3.0 in either direction is called non-stable; anything in
    between is "stable". Deliberately crude — SELF_CRITIQUE §2 names
    this out as statistically weak at low N (e.g. N=3 is a 1-vs-2
    mean comparison where one outlier flips the verdict). Production
    would swap this for bootstrapped CIs. For the capstone scope it's
    deterministic and good enough to light up a warning arrow.

    Returns "stable" when given fewer than 2 scores (nothing to compare).
    """
    if len(scores) < 2:
        return "stable"
    mid = len(scores) // 2
    first_half = sum(scores[:mid]) / mid
    second_half = sum(scores[mid:]) / len(scores[mid:])
    diff = second_half - first_half
    if diff > 3.0:
        return "improving"
    if diff < -3.0:
        return "declining"
    return "stable"
