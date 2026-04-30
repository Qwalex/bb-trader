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

## Forbidden Shortcuts
- Silent behavior changes without notes.
- Secret leakage in logs/docs.
- Large refactors without intermediate tracker updates.
