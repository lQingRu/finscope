# FinScope engineering playbook

FinScope adopts the engineering standards from the public playbook at `7af94b48bdd06907a304082edb3619f978e156e7`. Use the pinned policy and its exception process with the project references below. [Standards index](https://github.com/lQingRu/ai-engineering-playbook/blob/7af94b48bdd06907a304082edb3619f978e156e7/standards/README.md) · [Skill registry](https://github.com/lQingRu/ai-engineering-playbook/blob/7af94b48bdd06907a304082edb3619f978e156e7/registry/skills.yaml) · [Approval policy](https://github.com/lQingRu/ai-engineering-playbook/blob/7af94b48bdd06907a304082edb3619f978e156e7/global/AGENTS.md)

## Standards

| When changing | Playbook policy | FinScope guidance |
| --- | --- | --- |
| Module boundaries or durable documentation | [Architecture](https://github.com/lQingRu/ai-engineering-playbook/blob/7af94b48bdd06907a304082edb3619f978e156e7/standards/architecture.md) | [Architecture](../../architecture.md) and [domain docs](../../agents/domain.md) |
| Client components, state, or data fetching | [Frontend](https://github.com/lQingRu/ai-engineering-playbook/blob/7af94b48bdd06907a304082edb3619f978e156e7/standards/frontend.md) | [Web boundaries and UI patterns](../../architecture.md#runtime-and-boundaries) |
| Visual design or interaction | [UI/UX](https://github.com/lQingRu/ai-engineering-playbook/blob/7af94b48bdd06907a304082edb3619f978e156e7/standards/ui-ux.md) | [Rendered checks and accessibility target](../testing.md#local-checks) |
| API contracts, financial writes, or storage | [Backend and database](https://github.com/lQingRu/ai-engineering-playbook/blob/7af94b48bdd06907a304082edb3619f978e156e7/standards/backend.md) | [Architecture and invariants](../../architecture.md) and [recovery runbook](../../deployment.md#roll-back-or-roll-forward) |
| Behaviour or regression coverage | [Testing](https://github.com/lQingRu/ai-engineering-playbook/blob/7af94b48bdd06907a304082edb3619f978e156e7/standards/testing.md) | [Commands and checks](../testing.md) |
| Access, credentials, sensitive data, or dependencies | [Security](https://github.com/lQingRu/ai-engineering-playbook/blob/7af94b48bdd06907a304082edb3619f978e156e7/standards/security.md) | [Trust boundaries](../../architecture.md#runtime-and-boundaries) and [provider settings](../../deployment.md#provision-production) |
| Review, commit, or delivery | [Git](https://github.com/lQingRu/ai-engineering-playbook/blob/7af94b48bdd06907a304082edb3619f978e156e7/standards/git.md) | [Commit conventions](../../../AGENTS.md#git-commits) and [release flow](../../deployment.md#release-and-verify) |
| Requirements, slices, or blockers | [Tickets](https://github.com/lQingRu/ai-engineering-playbook/blob/7af94b48bdd06907a304082edb3619f978e156e7/standards/tickets.md) | [GitHub Issues](../../agents/issue-tracker.md) and [triage labels](../../agents/triage-labels.md) |

## Skill dependencies

Use [bootstrap-project](https://github.com/lQingRu/ai-engineering-playbook/tree/7af94b48bdd06907a304082edb3619f978e156e7/skills/bootstrap-project) to reconcile setup and [pair-implement](https://github.com/lQingRu/ai-engineering-playbook/tree/7af94b48bdd06907a304082edb3619f978e156e7/skills/pair-implement) for the agreed one-ticket workflow. Both have local standalone installations at the adopted playbook revision. The installed instructions and references resolve, and a fresh Codex skill listing reports both enabled.

The [Matt Pocock plugin](https://github.com/mattpocock/skills/tree/d65391149dbb5fe76478e76fa8d5122b2aa5a70e) is installed at `d65391149dbb5fe76478e76fa8d5122b2aa5a70e`. The scoped files below match the reviewed [v1.3.2 release](https://github.com/mattpocock/skills/tree/d1478fcb140db0b93c0c8df17bcfd311844749d0). A skill marked required applies when its workflow and trigger apply. The pinned registry supplies the contract and compatibility limits for each entry.

| Skill | Trigger and phase | Required | Dependencies and status |
| --- | --- | --- | --- |
| `setup-matt-pocock-skills` | Missing tracker, domain, or triage configuration during bootstrap | Conditional | Bundled setup templates and tracker access. FinScope's existing setup covers these surfaces. |
| `to-spec` | New specification during planning | Yes | GitHub tracker and triage vocabulary verified. Explicit-only skill listed as enabled in Codex. |
| `to-tickets` | Slice agreed work during planning | Yes | GitHub tracker and triage vocabulary verified. Explicit-only skill listed as enabled in Codex. |
| `tdd` | Observable behaviour change during pair implementation | Yes | `tests.md` and `mocking.md` verified. Use `codebase-design` when a seam needs design. Available in Codex. |
| `code-review` | Final review of a completed pairing ticket | Yes | Requires a fixed Git comparison, tracker scope, project standards, and independent Standards and Spec reviewers. Available in Codex. Verify both reviewer contexts at the review step. |
| `domain-modeling` | Resolve a domain term or record a qualifying decision | Yes | `GLOSSARY-FORMAT.md`, `ADR-FORMAT.md`, and the project's domain layout verified. Available in Codex. |
| `pr` | Prepare a pull request during pairing delivery | Yes | Requires completed review evidence. Available in Codex. |
| `codebase-design`, `prototype` | Design a boundary or test seam, or test a concrete design question | Advisory | Use `DEEPENING.md` or `DESIGN-IT-TWICE.md` for relevant interface work and `LOGIC.md` or `UI.md` for the matching prototype. Available in Codex. |
| `writing-for-agents` | Write or revise agent-facing guidance | Advisory | Available and used for this repository's agent routing. |
| `triage`, `teach` | Triage through the upstream workflow, or run a dedicated teaching session | Optional | Triage uses the configured tracker and label mapping. Teaching uses its format companions and a separate teaching directory. Use the registry when either workflow is requested. |

Wayfinder setup is deferred. The tracker documents the workflow. Its `wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, and `wayfinder:task` labels are absent. [Wayfinder tracker guidance](../../agents/issue-tracker.md#wayfinder)

### Web and database guidance

The web app uses React 19 with Vite and TanStack Router. Apply React guidance to `apps/web` and check any framework-specific example against that stack. The advisory Vercel skills below use the lockfile revision `5a37a6329fbad3666c3207392a6a7c0110e92efb` and are enabled in Codex. [Web manifest](../../../apps/web/package.json) · [Skill lockfile](../../../skills-lock.json) · [Vercel source](https://github.com/vercel-labs/agent-skills/tree/5a37a6329fbad3666c3207392a6a7c0110e92efb)

| Skill | Trigger | Companions and scope |
| --- | --- | --- |
| `vercel-react-best-practices` | React rendering, data fetching, or bundle performance during implementation or review | Use bundled rules applicable to this client runtime. |
| `vercel-composition-patterns` | Design or review reusable React component APIs | Use bundled rules, including the React 19 guidance where relevant. |
| `web-design-guidelines` | Additional web UI source review | Use the bundled `references/command.md` snapshot and verify the rendered flow separately. |

The optional PostgreSQL, visual critique, interaction polish, and deeper structural review skills are deferred. Use version-matched maintainer documentation and the relevant project checks. The installed frontend design and view-transition skills retain their existing task-specific scope. [Testing and verification](../testing.md)
