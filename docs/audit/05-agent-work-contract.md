# Agent Work Contract

## Objectives
- Keep changes small, traceable, and reversible.
- Update documentation in lockstep with implementation.
- Preserve business behavior unless task explicitly changes it.

## Decomposition Standard
- Prefer one isolated entity per file for utilities, constants, hooks, mappers, and adapters.
- Use pragmatic boundaries: avoid artificial file explosion that hurts navigation.
- Record what was extracted and why in `06-progress-tracker.md`.

## Required Per-Task Outputs (`AUD-###`)
- Scope and touched files.
- Risks found and mitigated.
- Manual verification steps.
- Documentation updated.
- Explicit status transition in `06-progress-tracker.md` (`todo -> in_progress -> done/blocked`).

## Context Retention Rules
- Keep one active task at a time (`in_progress`) to avoid context drift.
- Before pausing, write short handoff notes in the active task card: current state, next step, blockers.
- Keep the global sequence aligned with `07-full-audit-backlog.md`; do not skip wave order without reason.

## Forbidden Shortcuts
- Silent behavior changes without notes.
- Secret leakage in logs/docs.
- Large refactors without intermediate tracker updates.
