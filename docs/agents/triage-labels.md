# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual `Status` values used in this repo's Notion issue tracker.

| Label in mattpocock/skills | Notion `Status` | Meaning                                                                                              |
|----------------------------|-----------------|------------------------------------------------------------------------------------------------------|
| `needs-triage`             | `Draft`         | Maintainer needs to evaluate this issue                                                              |
| `needs-info`               | *(skipped)*     | Not used — solo project; reporter and maintainer are the same person                                |
| `ready-for-agent`          | `Ready`         | Fully specified, ready for an AFK agent to pick up                                                  |
| `ready-for-human`          | `Ready`         | Requires human implementation                                                                        |
| `wontfix`                  | `Icebox`        | Documented but intentionally not actioned — features, bugs, or improvements worth keeping on record but not worth pursuing |

When a skill mentions a triage role (e.g. "apply the AFK-ready label"), set the Notion `Status` property to the corresponding value in the right-hand column.
