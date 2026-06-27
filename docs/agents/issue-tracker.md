# Issue Tracker: Notion

Issues for this project are tracked in a Notion database called **User Stories**, inside the "⭐ Starlight - AI Planner" workspace.

## Access

- **Database URL**: https://app.notion.com/p/40a7ae8774c34f99acc0f814ecf8d701
- **Data source ID**: `collection://02166409-78d7-46f6-bced-08fdf5b4a64a`
- **MCP server**: `claude.ai Notion` — use `notion-fetch`, `notion-search`, `notion-create-pages`, `notion-update-page`

## Schema

| Property | Type    | Values                                                                                              |
|----------|---------|-----------------------------------------------------------------------------------------------------|
| `Story`  | title   | The story or task name                                                                              |
| `ID`     | text    | Custom identifier                                                                                   |
| `Feature`| select  | Authentication, Onboarding, Day Template, Date & Session Awareness, Backlog, Generated Day Plan, Basic Editing |
| `Priority`| select | High, Medium, Low                                                                                   |
| `Status` | select  | Draft, Ready, In Progress, Testing, Done, Icebox                                                   |
| `Type`   | select  | User Story, Task                                                                                    |
| `Notes`  | text    | Free-form notes                                                                                     |

## Operations

**Read issues** — fetch the database URL or use `notion-search` for keyword lookup:
```
notion-fetch: https://app.notion.com/p/40a7ae8774c34f99acc0f814ecf8d701
```

**Create an issue** — `notion-create-pages` with the data source as parent:
```
parent.data_source_id: "02166409-78d7-46f6-bced-08fdf5b4a64a"
Required properties: Story (title), Status, Type
```

**Update an issue** — `notion-update-page` with the page URL or ID.

## No PR triage surface

This repo does not use GitHub Issues. External PRs are not part of the triage queue.
