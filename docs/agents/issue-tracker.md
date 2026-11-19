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

## Wayfinder

Use one `wayfinder:map` issue per map. Link each ticket as a child and label it
`wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
Claim the first open, unassigned child in map order whose blockers are closed.
Assign it to the developer doing the work. On resolution, comment on the child,
close it, and add the decision and ticket link to the map.
