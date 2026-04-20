"""
Application configuration loaded from environment variables.
All secrets live in .env (git-ignored) — never in frontend code.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # LLM
    anthropic_api_key: str = ""
    llm_model: str = "claude-sonnet-4-6-20250415"
    llm_max_tokens: int = 1024
    llm_timeout_seconds: int = 30

    # Database
    database_url: str = "sqlite:///./aiops.db"

    # JWT
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

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
    # Sized for multi-test-case eval batches (each factuality case fires
    # 1 model call + 1 judge call + 1 hallucination check = 3 Claude calls).
    api_max_calls_per_minute: int = 30
    api_max_calls_per_user_per_minute: int = 20
    max_prompt_length: int = 10000
    max_login_attempts: int = 5
    login_lockout_minutes: int = 15

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
