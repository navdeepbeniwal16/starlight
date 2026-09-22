# Issue Tracker: Linear

Issues for this project are tracked in **Linear**, team **Starlight App** (key `STA`).

## Access

- **Team URL**: https://linear.app/starlight-app/team/STA
- **Team key**: `STA` — issues are identified as `STA-1`, `STA-2`, …
- **MCP server**: `linear-server` — key tools: `list_issues`, `get_issue`, `save_issue`
  (create **and** update), `list_projects`, `get_project`, `list_issue_statuses`,
  `list_issue_labels`

## Workflow statuses

`Backlog` → `Todo` → `In Progress` → `In Review` → `Done`, plus `Canceled` and
`Duplicate`. See `docs/agents/triage-labels.md` for how the skills' canonical triage
roles map onto these statuses.

## Categorization

- **Priority** — Linear's built-in field: `Urgent`, `High`, `Medium`, `Low`, `No priority`.
- **Area labels** — `api`, `mobile`, `database`, `infra`, `planner`.
- **Type labels** — `Feature`, `Bug`, `Improvement`

## Projects

Larger multi-issue efforts are grouped under Linear **Projects**:

- **Projects — task grouping** — group Tasks under a reusable goal + in-focus flag.
- **Migrate authentication to Clerk** — move identity/sessions off hand-rolled JWT/bcrypt.

## Operations

**Read issues** — `list_issues` (filter by `team`, `status`, `label`, `project`, or
assignee), or `get_issue` by identifier:

```
list_issues: team = "STA", status = "Todo"
get_issue: STA-14
```

**Create or update an issue** — `save_issue` handles both. At minimum supply `team` and
`title`; set `status`, `labels`, `priority`, and `project` as appropriate:

```
save_issue: team = "STA", title = "…", status = "Backlog", labels = ["api"]
```

## Branch & PR linkage

One issue → one short-lived branch → one pull request. Branch names carry the Linear
identifier (e.g. `sta-14-…`) so Linear auto-links the branch and PR to the issue and
advances its status through `In Progress` / `In Review` / `Done`.

## No PR triage surface

This repo does not use GitHub Issues. External PRs are not part of the triage queue.
