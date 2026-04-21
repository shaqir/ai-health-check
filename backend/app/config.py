"""
Application configuration loaded from environment variables.
All secrets live in .env (git-ignored) — never in frontend code.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # LLM
    anthropic_api_key: str = ""
    llm_model: str = "claude-sonnet-4-20250514"
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
    app_name: str = "AIHealthCheck"
    debug: bool = True
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Evaluation
    drift_threshold: float = 75.0
    eval_schedule_minutes: int = 60
    health_check_schedule_minutes: int = 5

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
