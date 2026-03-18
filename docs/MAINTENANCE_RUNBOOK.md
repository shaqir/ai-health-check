# Maintenance Runbook

> ARTI-409-A | AIHealthCheck | Due: Phase 3

Operational playbook for common scenarios. Follow these procedures when alerts trigger.

---

## Scenario 1: Latency exceeds threshold

**Trigger:** Average latency > 2000ms for a service on the dashboard.

**Steps:**
1. Open the service in the registry and click **Test Connection**
2. If test connection also shows high latency → likely an upstream provider issue
3. Check Anthropic's status page for known outages
4. If only one service is affected → check that service's model name and endpoint URL
5. Create an incident with severity **medium** and run the troubleshooting checklist
6. If latency is > 10 seconds → consider temporary fallback: set service to inactive

**Escalation:** If latency does not recover within 1 hour, notify the team lead.

---

## Scenario 2: Quality score drops below threshold

**Trigger:** Evaluation harness reports quality_score < 75% and drift_flagged = true.

**Steps:**
1. Review the eval run details on the dashboard — which category failed? (factuality or format)
2. Run the evaluation again manually to confirm it's not a transient issue
3. If confirmed → create an incident with severity **high**
4. Run the troubleshooting checklist:
   - **Data issue?** — Check if test cases have changed
   - **Prompt change?** — Check if system prompts were modified
   - **Model update?** — Check if the LLM provider updated the model version
   - **Infrastructure?** — Check connection health
   - **Safety/policy?** — Check if the model is refusing to answer test prompts
5. Use **Generate Summary** to draft a stakeholder update (review before approving)
6. Create a maintenance plan with rollback steps

**Escalation:** If quality score is below 50%, escalate to severity **critical**.

---

## Scenario 3: PII detected in LLM output

**Trigger:** Manual review reveals that an LLM response contains personally identifiable information.

**Steps:**
1. **Immediately** create an incident with severity **critical**
2. Document exactly what PII was found and in which response
3. Do NOT approve the LLM summary — reject the draft
4. Check the service's sensitivity label — if it's **confidential**, this is a data handling failure
5. Review what prompt was sent to the LLM (check if incident symptoms contained PII)
6. Update the Privacy Routing page if the data handling explanation needs clarification
7. Consider switching the affected service to a local LLM (Ollama) via the llm_client.py wrapper

**Escalation:** Notify instructor/team lead immediately. Document in the audit log.

---

## Scenario 4: LLM provider is down

**Trigger:** Test Connection returns "failure" status.

**Steps:**
1. Confirm by testing connection on multiple services
2. Check Anthropic's status page
3. The incident triage workflow still works without LLM — you can create incidents, fill checklists, and create maintenance plans manually
4. Only the "Generate Summary" button will fail — write the summary manually instead
5. If outage persists > 2 hours → create an incident documenting the outage and impact

**Note:** The app is designed to degrade gracefully. No feature should crash or show a blank screen when the LLM is unavailable.

---

## Scenario 5: Unauthorized access attempt

**Trigger:** Audit log shows a Viewer role attempted an Admin/Maintainer action.

**Steps:**
1. The RBAC middleware should have blocked the action (HTTP 403)
2. Verify in the audit log that the action was NOT executed
3. If the action was somehow executed → this is a **critical** security bug
4. Check the route handler to confirm it has the `require_role()` dependency
5. Document the finding and add a test case to prevent regression

---

## General Maintenance Schedule

| Task | Frequency | Owner |
|------|-----------|-------|
| Run evaluation harness | Daily (via APScheduler) | Automated |
| Health check all services | Every 5 minutes | Automated |
| Review audit log for anomalies | Weekly | Admin |
| Export compliance evidence | Monthly or as needed | Admin |
| Review and update test cases | Bi-weekly | Maintainer |

---

*Created: Phase 3 | Last updated: [date]*
