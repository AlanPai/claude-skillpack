---
name: resume
description: "Resume work from a previous handover note. Use when the user says /resume, 接班, 繼續之前的工作, continue previous work, pick up where I left off, or references continuing a prior project. Also suggest this when the user seems to be re-explaining context that might already exist in a handover note."
---

# Resume — 接班

Load a previous handover note and inject its context into this conversation.

**Scripts location**: `~/.claude/skills/handover/scripts/`
**Backend**: Notion database (requires `NOTION_HANDOVER_TOKEN` and `NOTION_HANDOVER_DB_ID` env vars)

## Script output handling

Every script outputs JSON:
- `{ "ok": false, "disabled": true, ... }` → This device has handover disabled. Tell the user: "這台機器沒啟用 handover（可跑 `node ~/.claude/skills/handover/scripts/setup.mjs` 啟用）"，DO NOT proceed.
- `{ "ok": false, "error": "Missing ..." }` → Credentials not configured. Tell the user: "handover 還沒設定，請跑 `node ~/.claude/skills/handover/scripts/setup.mjs`"，DO NOT ask them to manually create `.env`.

## Usage

| Command | Behavior |
|---------|----------|
| `/resume` (no args) | Call `list.mjs` first, show recent handovers as a table, let user pick |
| `/resume 5` | Load handover by ID |
| `/resume auth` | Search by topic (fuzzy match) |
| `/resume --project=gmail-scan` | Latest handover for that project |
| `/resume --project=gmail-scan parser` | Search within a specific project |

## Step 1: Query the database

**No args — show list first:**
```bash
node ~/.claude/skills/handover/scripts/list.mjs
```

Format as a table with project summary, then ask the user to pick one.

**With args — direct lookup:**
```bash
node ~/.claude/skills/handover/scripts/resume.mjs [--project=xxx] [query]
```

If the user can't remember the project name, use fuzzy search:
```bash
node ~/.claude/skills/handover/scripts/list.mjs --search=<keyword>
```

## Step 2: Format the context block

After receiving JSON from `resume.mjs`, detect if same environment (compare `device` field with current `hostname`).

**Same environment** — show Layer 1 + Layer 2:

```
=== HANDOVER CONTEXT (ID: {id}, {created_at}) ===
Project: {project} | Type: {session_type}
Topic: {topic}
Device: {device} | Branch: {git_branch} ({git_commit}) | Dir: {working_dir}

## Accomplished
- {each item}

## Decisions
- {each item}

## Blocked
- {each item}

## Next Steps
- [ ] {each item}

## Attempted Approaches
- {each item}

## Lessons Learned
- {each item}

## Summary
{conversation_summary}

## Key Decisions (Cumulative)
{key_decisions}

## Active Context
{active_context}

## Roadmap
{roadmap}

## Environment Notes
Test status: {test_status} | Files: {open_files}
{env_notes}
===================================================
```

**Cross-environment** (different device or pasting to another AI): show Layer 1 only, omit device/working_dir/git/test_status/open_files/env_notes.

## Step 3: Summarize and ask

Briefly summarize what was handed over, then ask:
> 要繼續 Next Steps 中的項目，還是有其他方向？
