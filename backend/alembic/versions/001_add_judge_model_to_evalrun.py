"""add judge_model to eval_runs

Revision ID: 001_judge_model
Revises:
Create Date: 2026-04-20

Records which judge model produced the scores on each EvalRun row.
Nullable so historical rows (pre-two-tier) keep working.
"""
from alembic import op
import sqlalchemy as sa


revision = "001_judge_model"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "eval_runs",
        sa.Column("judge_model", sa.String(length=100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("eval_runs", "judge_model")
