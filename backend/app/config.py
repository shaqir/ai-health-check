"""
Application configuration loaded from environment variables.
All secrets live in .env (git-ignored) — never in frontend code.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # LLM — two-model architecture
    # Actor: the service-under-test model (synthesis, dashboard insights, compliance reports).
    # Judge: scores factuality + hallucination. Haiku keeps the judge cheap + fast and
    # a different family from the actor to reduce self-scoring correlation.
    # Input safety is regex-only (see safety.py) — no LLM classifier, no third model.
    anthropic_api_key: str = ""
    llm_model: str = "claude-sonnet-4-6-20250415"
    judge_model: str = "claude-haiku-4-5-20251001"
    llm_max_tokens: int = 1024
    llm_timeout_seconds: int = 30

    # Database
    database_url: str = "sqlite:///./aiops.db"

    # JWT
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

    # Admin Recovery
    admin_recovery_key: str = ""  # Set in .env to enable admin password reset failsafe

    # App
    app_name: str = "AI Health Check"
    debug: bool = True
    # Echo every SQL statement to the terminal. Kept separate from `debug`
    # so we can keep FastAPI exception detail without flooding the logs
    # during a demo. Default off.
    log_sql: bool = False
    # Background scheduler (health checks every N minutes). Disable for
    # demos so metrics stay stable during narration.
    scheduler_enabled: bool = True
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Evaluation
    drift_threshold: float = 75.0
    health_check_schedule_minutes: int = 5
    # Automated eval runs (APScheduler). Set SCHEDULER_ENABLED=false to opt out.
    eval_schedule_minutes: int = 60

    # API Budget (USD) — set 0 for unlimited
    api_daily_budget: float = 5.0
    api_monthly_budget: float = 25.0
    # Sized for demo eval batches. Two-model + merged judge architecture means a
    # factuality test case now fires 2 Claude calls (1 actor + 1 merged judge),
    # and a format_json case fires 1 — so these limits are comfortable headroom
    # for a 10-case eval (~16 calls) plus concurrent UI activity.
    api_max_calls_per_minute: int = 30
    api_max_calls_per_user_per_minute: int = 20
    max_prompt_length: int = 10000

    # ── Hard caps enforced by enforce_call_limits (single gatekeeper) ──
    # These reject a Claude call BEFORE it touches the network, so a bug
    # or misuse can't silently spend the daily budget in one shot.
    # Tuned for demo-scale prompts; raise in .env if your use case is
    # genuinely larger.
    hard_max_cost_per_call_usd: float = 0.05   # worst-case cost per single call
    hard_max_tokens_per_call: int = 2000        # max_tokens ceiling regardless of caller
    hard_max_prompt_chars: int = 12000          # hard ceiling on input text length
    max_login_attempts: int = 5
    login_lockout_minutes: int = 15

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
