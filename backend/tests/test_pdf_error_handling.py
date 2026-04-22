"""
Compliance PDF export — runtime errors inside reportlab must surface
as a clean 500 JSON response, not a FastAPI "Internal Server Error"
bucket with an unhelpful detail.

The existing endpoint catches `ImportError` (reportlab not installed)
but any runtime failure inside `doc.build(elements)` (malformed row
data, invalid style, buffer I/O, etc.) escapes the handler and lands
in FastAPI's default 500 path with a generic detail. Hard to debug,
bad demo-day UX.

Regression guard: a simulated reportlab failure returns HTTP 500 with
a `detail` string that names the source (PDF generation) and the
underlying cause.
"""

from app.models import (
    AIService,
    Environment,
    Incident,
    IncidentStatus,
    MaintenancePlan,
    SensitivityLabel,
    Severity,
)
from tests.conftest import auth_header


def _seed_exportable_records(db):
    """Minimum seed: one service + one incident + one plan so all three
    PDF table sections attempt to render."""
    svc = AIService(
        name="PDFSrc", owner="QA", environment=Environment.dev,
        model_name="m", sensitivity_label=SensitivityLabel.public,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)

    inc = Incident(
        service_id=svc.id, severity=Severity.low,
        symptoms="sym", status=IncidentStatus.open,
    )
    db.add(inc)
    db.commit()
    db.refresh(inc)

    plan = MaintenancePlan(
        incident_id=inc.id, risk_level=Severity.low,
        rollback_plan="r", validation_steps="v",
    )
    db.add(plan)
    db.commit()


def test_pdf_export_runtime_error_returns_clean_500(
    client, db, admin_token, monkeypatch,
):
    """If `SimpleDocTemplate.build` raises for any reason during PDF
    generation, the endpoint must return HTTP 500 with a JSON body
    whose `detail` identifies PDF generation as the source. It must
    NOT bubble the raw exception up as a FastAPI 'Internal Server
    Error' (which gives the user no actionable information)."""
    _seed_exportable_records(db)

    # Force reportlab's build step to blow up. Patching the class
    # method hits any SimpleDocTemplate instance created afterwards.
    from reportlab.platypus import SimpleDocTemplate

    def _broken_build(self, elements):
        raise RuntimeError("simulated reportlab malformed-table failure")

    monkeypatch.setattr(SimpleDocTemplate, "build", _broken_build)

    res = client.post(
        "/api/v1/compliance/export",
        json={"format": "pdf"},
        headers=auth_header(admin_token),
    )

    assert res.status_code == 500, (
        f"Expected 500 on PDF build failure, got {res.status_code}: {res.text[:200]}"
    )
    body = res.json()
    assert "detail" in body, "Error body must have a `detail` field"
    detail_lower = body["detail"].lower()
    # The detail must name PDF generation as the failure source so an
    # operator knows WHERE to look, not just that something died.
    assert "pdf" in detail_lower, (
        f"detail should identify PDF as source, got: {body['detail']!r}"
    )


def test_pdf_export_happy_path_still_works(client, db, admin_token):
    """Regression guard: the try/except wrapping must not affect the
    success path. With real reportlab and real data, PDF export still
    returns 200 + application/pdf content."""
    _seed_exportable_records(db)

    res = client.post(
        "/api/v1/compliance/export",
        json={"format": "pdf"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert len(res.content) > 1000
