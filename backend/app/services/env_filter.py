"""
Shared environment-filter helper for router queries.

Extracted from dashboard.py so both the Dashboard and Evaluations routers
can apply the same mapping (production → prod, etc.) and join-to-AIService
pattern when scoping queries to an environment.

The helper joins the given query to `AIService` and filters by the
`Environment` enum. If the passed environment value is missing, "all",
empty, or an unknown value, the query is returned unchanged.
"""

from app.models import AIService, Environment


def apply_env_filter(query, environment: str | None):
    """Apply environment filter by joining to AIService.

    Accepts the frontend-friendly long form ('production') or the DB enum
    values ('prod', 'staging', 'dev'). Unknown values are treated as a
    no-op rather than raised so the caller never needs to guard it.
    """
    if not environment or environment == "all":
        return query

    env_map = {"production": "prod", "staging": "staging", "dev": "dev"}
    env_val = env_map.get(environment, environment)
    try:
        env_enum = Environment(env_val)
        return query.join(AIService).filter(AIService.environment == env_enum)
    except ValueError:
        return query
