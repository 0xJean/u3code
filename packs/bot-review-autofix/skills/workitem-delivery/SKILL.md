---
name: workitem-delivery
description: Standard Team Cockpit delivery loop for coding agents working on a u3code-hub WorkItem. Use when implementing a WorkItem, verifying acceptance criteria, or syncing progress back to Team Hub.
---

# Team Cockpit WorkItem Delivery

When working on a task tracked in **Team Cockpit (`u3code-hub`)**:

1. **Read authoritative context first**
   - Call `team_hub_get_context` to inspect locked Owner Directives and active architecture decisions.
   - If you have a `workItemId`, call `team_hub_get_work_item` to read the full Markdown specification and Acceptance Criteria (`AC-1`, `AC-2`, ...).
2. **Respect locked directives**
   - Never violate active project directives (such as branch merge policies or test requirements).
3. **Verify acceptance criteria incrementally**
   - After writing code and running real tests that prove an acceptance criterion passes, call `team_hub_update_work_item` with `verifyAcIds: ["AC-1", ...]` rather than rewriting the entire checklist.
4. **Publish a concise Pulse at milestones or blockers**
   - Call `team_hub_publish_pulse` with:
     - `doneSummary`: 1-2 concrete sentences on what shipped or was verified.
     - `decisions`: Any non-obvious technical choices made.
     - `blockers`: Include `needsAttentionRoles` (e.g. `["owner"]` or `["qa"]`) if blocked on a decision.
     - `nextStep`: The immediate next action.
