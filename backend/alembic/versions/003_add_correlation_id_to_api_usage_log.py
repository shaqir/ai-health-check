"""add correlation_id to api_usage_log

Revision ID: 003_correlation_id
Revises: 002_run_status
Create Date: 2026-04-22

Per-request UUID that every Claude call fired inside one HTTP request
shares. Enables the Settings → Call Trace view to group activities:
"evaluation run · 16 calls · $0.08 · 18s" — one correlation_id, 16
api_usage_log rows. Nullable so background-scheduler calls (no HTTP
request in flight) and legacy rows keep working.

Indexed because the trace endpoint filters by correlation_id.
"""
from alembic import op
import sqlalchemy as sa


revision = "003_correlation_id"
down_revision = "002_run_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "api_usage_log",
        sa.Column("correlation_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_api_usage_log_correlation_id",
        "api_usage_log",
        ["correlation_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_api_usage_log_correlation_id", table_name="api_usage_log")
    op.drop_column("api_usage_log", "correlation_id")
