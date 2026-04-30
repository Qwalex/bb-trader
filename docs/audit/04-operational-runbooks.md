# Operational Runbooks

## Incident Classes

- Auth/session failures.
- Exchange execution mismatch.
- Signal parsing degradation.
- External provider downtime (Telegram/VK/OpenRouter/Bybit).

## Generic Response Steps

1. Triage and classify severity.
2. Stabilize user-facing behavior (degrade safely).
3. Capture logs and affected IDs.
4. Apply rollback/hotfix.
5. Document root cause and preventive action.

## Mandatory Artifacts

- Incident summary.
- Scope and impact.
- Mitigation and residual risk.
- Follow-up `AUD-###` task IDs.
