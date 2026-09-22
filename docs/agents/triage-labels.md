# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to
the actual workflow **statuses** used in this repo's Linear tracker (team `STA`).

| Label in mattpocock/skills | Linear status | Meaning                                                                                              |
|----------------------------|---------------|------------------------------------------------------------------------------------------------------|
| `needs-triage`             | `Backlog`     | Maintainer still needs to evaluate and spec this issue                                               |
| `needs-info`               | *(skipped)*   | Not used — solo project; reporter and maintainer are the same person                                |
| `ready-for-agent`          | `Todo`        | Fully specified, ready for an AFK agent to pick up                                                  |
| `ready-for-human`          | `Todo`        | Specified, but requires human implementation                                                        |
| `wontfix`                  | `Canceled`    | Documented but intentionally not actioned — worth keeping on record but not worth pursuing          |

When a skill mentions a triage role (e.g. "apply the AFK-ready label"), set the Linear
workflow status to the corresponding value in the middle column.

Beyond triage, issues run through the delivery lifecycle **`Todo` → `In Progress` →
`In Review` → `Done`** (`Duplicate` for dupes). That progression is normally driven by the
linked branch and PR, not set by hand.
