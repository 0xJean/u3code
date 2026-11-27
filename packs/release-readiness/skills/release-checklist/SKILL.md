---
name: release-checklist
description: Prepare and audit a cross-repository release tracked in u3code-hub. Use when compiling release notes, checking gate status, or verifying rollback plans.
---

# Cross-Repository Release Checklist

1. Call `team_hub_get_context` to inspect active work items, gate status, and locked Owner Directives.
2. Call `team_hub_get_review_queue` to confirm zero `bot_blocked`, `ci_blocked`, or unintended `orphan` PRs remain for the release scope.
3. For each work item included in the release, verify that all required Acceptance Criteria (`AC-*`) are checked off and that a clear rollback plan is documented.
4. Highlight any rejected gates or recurring risks from Living Project Memory before requesting `prod_go` approval.
