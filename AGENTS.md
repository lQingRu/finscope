## Project guidance

- Product scope and implementation status → [Product requirements](docs/product-requirements.md).
- Runtime, module boundaries, and persistence → [Architecture](docs/architecture.md).
- Engineering standards and skill dependencies → [Playbook index](docs/standards/playbook/README.md).
- Test commands, browser checks, and CI → [Testing and verification](docs/standards/testing.md).
- For an agreed one-ticket pairing workflow, invoke `$pair-implement` with the issue identifier.

## Agent skills

### Issue tracker

Track work in GitHub Issues. When reading, publishing, or linking tickets, follow `docs/agents/issue-tracker.md`.

Keep each ticket focused on its owner's work. Follow [Implementation and human verification](docs/agents/issue-tracker.md#implementation-and-human-verification) when defining acceptance criteria or handing off human-only work.

### Triage labels

When triaging an issue, use the five labels defined in `docs/agents/triage-labels.md`.

### Domain docs

FinScope uses one root glossary and one directory for architecture decisions. Before exploring a domain area, read `docs/agents/domain.md`.

## Git commits

Use Conventional Commits for every commit. Write subjects as `type(scope): imperative summary` or `type: imperative summary`, for example `feat(transactions): record everyday income and expenses`. Check every new commit subject before pushing.
