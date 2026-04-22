---
name: list
description: "List handover records. Use when the user says /list, 看交班紀錄, show handovers, list projects, 列出交班單, or wants to browse their handover history."
---

# List — 瀏覽交班紀錄

List recent handover records, optionally filtered by project.

**Scripts location**: `~/.claude/skills/handover/scripts/`
**Backend**: Notion database (requires `NOTION_HANDOVER_TOKEN` and `NOTION_HANDOVER_DB_ID` env vars)

## Script output handling

Every script outputs JSON:
- `{ "ok": false, "disabled": true, ... }` → This device has handover disabled. Tell the user: "這台機器沒啟用 handover（可跑 `node ~/.claude/skills/handover/scripts/setup.mjs` 啟用）"，DO NOT proceed.
- `{ "ok": false, "error": "Missing ..." }` → Credentials not configured. Tell the user: "handover 還沒設定，請跑 `node ~/.claude/skills/handover/scripts/setup.mjs`"，DO NOT ask them to manually create `.env`.

## Usage

| Command | Behavior |
|---------|----------|
| `/list` | List all recent handovers + show all known projects |
| `/list --project=gmail-scan` | List handovers for a specific project |
| `/list --search=gmail` | Fuzzy search — find projects containing "gmail" |

## Script call

```bash
node ~/.claude/skills/handover/scripts/list.mjs [--project=xxx] [--search=xxx] [--limit=N]
```

## Format output

**When listing all (no filter)**, show project summary first, then the table:

```
Known projects:
  gmail-scan (5 handovers, last: 2026-04-12)
  auth-system (3 handovers, last: 2026-04-11)

| ID | Date       | Project     | Topic                  | Type  |
|----|------------|-------------|------------------------|-------|
| 5  | 2026-04-12 | gmail-scan  | Fix parser regex       | debug |
| 4  | 2026-04-11 | auth-system | Add JWT refresh tokens | dev   |
```

**When using `--search=`**, show matched projects:

```
Search "gmail" matched: gmail-scan, gmail-billing

| ID | Date       | Project      | Topic                | Type  |
|----|------------|--------------|----------------------|-------|
| 5  | 2026-04-12 | gmail-scan   | Fix parser regex     | debug |
```

After showing the list, ask:
> 要 /resume 哪一筆？可以輸入 ID 或專案名稱。
