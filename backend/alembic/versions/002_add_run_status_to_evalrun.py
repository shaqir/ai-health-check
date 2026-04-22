"""add run_status to eval_runs

Revision ID: 002_run_status
Revises: 001_judge_model
Create Date: 2026-04-20

Tri-state run completeness so the UI stops showing "0% quality, Healthy status"
for runs where no test produced a measurable score.
"""
from alembic import op
import sqlalchemy as sa


revision = "002_run_status"
down_revision = "001_judge_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "eval_runs",
        sa.Column("run_status", sa.String(length=20), nullable=False, server_default="complete"),
    )


def downgrade() -> None:
    op.drop_column("eval_runs", "run_status")
