# GitHub Issues

Issues and specs live in `lQingRu/finscope`. Use `gh` from this checkout.
Before creating the first issue in a session, verify the target with
`gh repo view --json nameWithOwner`.

- Publish a ticket with `gh issue create --title "..." --body-file <path>`.
- Fetch a ticket with `gh issue view <number> --json number,title,body,labels,comments`.
- List open tickets with `gh issue list --state open`. Filter by label when triaging.
- Link child tickets using GitHub sub-issues. If unavailable, add the child to the parent's task list and put `Part of #<parent>` in the child body.
- Record blockers using GitHub issue dependencies. If unavailable, put `Blocked by: #<number>` in the child body. A ticket is unblocked when all blockers are closed.
- Change labels with `gh issue edit`. When closing a ticket, post the resolution with `gh issue comment` before running `gh issue close`.

PRs as a request surface: no.

## Implementation and human verification

Define each ticket's responsibility and observable acceptance criteria. An implementation issue starts with its implementation scope or status. Record test results there and check off each criterion the evidence verifies. Use automated tests and agent-run checks for everything they can verify. Ask for human verification only where evidence is still missing and a human must provide it, such as a real owner sign-in, a required approval, or access to a restricted environment.

1. Check for human-only work when scoping the issue and again before handing it back or closing it. As soon as you identify it, create or update a linked sub-issue. Apply `ready-for-human` to that sub-issue and assign the person responsible when known. Give them a checklist of the remaining steps, where to perform them, the expected result, and what to report. Keep credentials and tokens in the relevant provider settings.
2. Keep the human checklist and any **Human action required** heading in the human-owned sub-issue. On the implementation issue, record completed implementation checks and link to the sub-issue. Base the implementation issue's triage label on its own work. Record a GitHub dependency if the sub-issue blocks remaining implementation work or closure. Continue any work you can complete independently.
3. Verify the sub-issue and its link are visible in GitHub before handoff. Include the sub-issue link and the next human action in your reply.
4. Once the human work is verified, record the result and close the sub-issue under the normal issue-closing procedure. Close the implementation issue once its acceptance criteria are verified and its recorded blockers are resolved.

## Wayfinder

Use one `wayfinder:map` issue per map. Link each ticket as a child and label it
`wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
Claim the first open, unassigned child in map order whose blockers are closed.
Assign it to the developer doing the work. On resolution, comment on the child,
close it, and add the decision and ticket link to the map.
