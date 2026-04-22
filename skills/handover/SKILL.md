---
name: handover
description: "Cross-device, cross-agent work handover notes. Use this skill whenever the user says /handover, 交班, 我要先停了, wrap up, hand off, or switch devices. Also proactively suggest /handover when the conversation is approaching context limits and meaningful work has been done, or when the user indicates they are stopping work."
---

# Handover Skill

Manages structured handover notes so work context survives across sessions, devices, agents, and accounts. A handover note captures what was accomplished, decisions made, blockers, and next steps — so the next session can pick up without re-explaining everything.

**Scripts location**: `~/.claude/skills/handover/scripts/`
**Backend**: Notion database (cross-device sync via Notion cloud)

**Credentials** are read from either:
1. Environment variables: `NOTION_HANDOVER_TOKEN` and `NOTION_HANDOVER_DB_ID`
2. Fallback file: `~/.claude/skills/handover/.env` (simple `KEY=VALUE` format)

The `.env` file is the recommended way — it works across all Claude Code sessions regardless of working directory, without needing `setx` to propagate. The file is gitignored.

## Script output handling

Every script in `scripts/` outputs JSON. Handle the response like this:

- `{ "ok": true, ... }` — success, continue with result.
- `{ "ok": false, "disabled": true, "message": "..." }` — **this device has handover disabled** (user chose Mode C in setup wizard). Tell the user plainly: "這台機器沒啟用 handover（可執行 `node ~/.claude/skills/handover/scripts/setup.mjs` 啟用）"，**DO NOT** try to work around it or proceed to preview. Exit the flow cleanly.
- `{ "ok": false, "error": "Missing NOTION_HANDOVER_TOKEN ...", "hint": "..." }` — credentials not configured. Tell the user: "handover 還沒設定，請執行 `node ~/.claude/skills/handover/scripts/setup.mjs`"，**DO NOT** ask them to manually create `.env` — the wizard handles that (Mode A for existing DB, Mode B for fresh setup, Mode C to opt out).
- Other `{ "ok": false, "error": ... }` — report the error and hint (if present) to the user.

## Setup wizard

If credentials are missing or the user wants to reconfigure, direct them to run:
```
node ~/.claude/skills/handover/scripts/setup.mjs
```
It offers three modes:
- **Mode A** — Paste existing token + DB ID → verify → write `.env`
- **Mode B** — Guided flow: create integration → create parent page → auto-create DB with full schema
- **Mode C** — Disable handover on this device (writes `.env.disabled` marker)

**Note**: Handover IDs are now Notion UUIDs (e.g. `34268f11-f3da-8189-...`), not integers. The old SQLite integer IDs no longer apply.

---

## /handover [session_type]

Write a handover note for the current session.

### Step 1: Determine session_type

If the user specifies a type, use it. Otherwise infer from conversation content:

| Type | When to use | Priority fields | Depth |
|------|------------|----------------|-------|
| `dev` | Feature development, coding | accomplished, decisions, next_steps | Light — design docs can be re-read, just track progress |
| `debug` | Debugging, troubleshooting | attempted_approaches, lessons_learned, blocked | **Most detailed** — "what was tried and why it failed" is more valuable than the fix itself |
| `discussion` | Planning, architecture discussions | decisions, lessons_learned, conversation_summary | Record key conclusions and disagreements |
| `admin` | Admin tasks, maintenance | next_steps, blocked | Lightest — just track TODOs and blockers |

### Step 2: Analyze conversation and extract fields

Review the entire conversation and extract:

**Layer 1 — Universal (always fill these):**
- `project`: Project name (see auto-detection below)
- `topic`: One-line description of what this session was about
- `session_type`: dev / debug / discussion / admin
- `accomplished`: Array of what was completed
- `decisions`: Array of decisions made and their rationale
- `blocked`: Array of blockers (null if none)
- `next_steps`: Array of concrete next actions
- `attempted_approaches`: Array of approaches tried and outcomes (especially for debug)
- `lessons_learned`: Array of insights gained
- `conversation_summary`: Free-text summary of the session
- `key_decisions`: Cumulative permanent record (see Carry-Forward section below)
- `active_context`: Rolling summary of current state (see Carry-Forward section below)
- `roadmap`: Development roadmap with current progress (see Carry-Forward section below)
- `project_links`: All project paths, URLs, and credential sources in one block (see Carry-Forward section below)

**Depth rules by session_type:**
- For `dev`: accomplished, decisions, and next_steps should be thorough. attempted_approaches can be brief.
- For `debug`: attempted_approaches and lessons_learned must be **very detailed** — include what was tried, what happened, and why it didn't work. This is the most valuable information for debugging continuity.
- For `discussion`: Focus on decisions (with rationale), points of agreement/disagreement, and lessons_learned.
- For `admin`: Keep it minimal — just next_steps and blocked. Other fields can be brief or null.

### Step 2.5: Carry-Forward — Build cumulative context

Before writing a new handover, **check if there's a previous handover for the same project**:

```bash
node ~/.claude/skills/handover/scripts/resume.mjs --project=<project_name>
```

If a previous handover exists, use its `key_decisions` and `active_context` as the foundation for the new handover's cumulative fields.

#### `key_decisions` — Permanent record (append-only)

This field accumulates **major decisions that shape the project long-term**. It is a free-text string, NOT an array.

**What belongs here:**
- Architecture decisions and rationale ("Chose JWT over sessions for cross-service auth")
- Technology choices ("Using lxml instead of BeautifulSoup — 3x faster for our use case")
- Design patterns adopted ("All API endpoints follow REST naming convention")
- Known gotchas/caveats ("Gmail API date formats are inconsistent — always validate")
- Conventions established ("Test files go in `__tests__/` with `.test.ts` suffix")

**Rules:**
- **Append new decisions** from the current session to the existing `key_decisions`
- **Never remove** a decision unless it has been explicitly reversed/superseded — in that case, update it (e.g., "~~JWT~~ → Switched to session-based auth because...")
- **Keep each decision to 1-2 lines** — enough to understand the what and why
- No hard character limit, but keep it concise. If it grows beyond ~30 items, consolidate related decisions into grouped summaries.

**Example:**
```
- [2026-04-10] Chose JWT with RS256 for cross-service auth (HS256 doesn't support key rotation)
- [2026-04-11] Gmail API date format is unstable — added defensive parsing with fallback chain
- [2026-04-12] Switched from BeautifulSoup to lxml — 3x faster, critical for batch processing
- [2026-04-12] Test strategy: integration tests hit real DB, no mocks (burned by mock/prod divergence)
```

#### `active_context` — Rolling summary (compressed each handover)

This field captures the **current working state** — what's in progress, what's blocked, recent progress.

**What belongs here:**
- Current blockers and their status
- In-progress work items
- Recent accomplishments (last 2-3 sessions worth)
- Immediate next steps

**Rules:**
- Each handover, **rewrite** this field:
  - Remove resolved blockers
  - Remove completed items that are no longer relevant
  - Add new items from the current session
  - Compress older items into brief summaries
- Target length: **~500-1000 characters**. If it grows beyond this, aggressively compress older items.
- This field should answer: "What is the current state of this project right now?"

**Example:**
```
Currently working on: refresh token endpoint (70% done — DB schema ready, API handler in progress)
Blocked: Rate limit on Gmail API — need to wait until 2026-04-13 to resume batch testing
Recently completed: Fixed billing parser regex, added defensive date parsing
Up next: Finish refresh endpoint → write integration tests → deploy to staging
```

#### `roadmap` — Development roadmap (updated when plans change)

This field tracks the **full development plan** and **current progress**. It is a free-text string.

**What belongs here:**
- Phased development plan with clear milestones
- Current phase / stage indicator (e.g., ">>> Phase 1 — IN PROGRESS")
- Completed phases marked with checkmarks
- Future phases with brief descriptions

**Rules:**
- **Carry forward** the previous roadmap as-is
- **Update progress markers** to reflect current status (move the "IN PROGRESS" indicator)
- **Mark completed phases** with [DONE]
- **If the plan has changed** during this session (new phases added, phases reordered, scope changed), update the roadmap to reflect the new plan
- If no development plan exists or was discussed, set to null

**Example:**
```
Phase 1 [DONE]: MVP — handover.mjs + resume.mjs + SKILL.md
Phase 2 [DONE]: 環境層自動偵測 + 專案名稱正規化
>>> Phase 3 [IN PROGRESS]: 多 Agent 整合
  - [ ] list.mjs 匯出 Markdown/JSON
  - [x] --search 模糊搜尋
  - [ ] clean.mjs 清理過期紀錄
Phase 4: 進階功能
  - FTS5 全文搜尋
  - 匯出/匯入機制
  - 刪除/編輯單筆交班單
```

#### `project_links` — 專案環境與路徑總覽 (carry-forward)

This field consolidates **all locations, URLs, and credential sources** related to the project into one easy-to-scan block. It is a free-text string using categorized `key: value` format.

**Categories** (omit any category that has no entries):

```
📁 本地環境
- 工作目錄: /c/Users/user/my-project
- Skill 目錄: ~/.claude/skills/handover/
- 設定檔: ~/.claude/skills/handover/.env

📦 版本控制
- Git Repo: https://github.com/user/my-project
- 主要分支: main
- 開發分支: feat/xxx

🌐 部署環境
- Vercel 專案: https://vercel.com/team/my-project
- Production URL: https://my-project.vercel.app
- Staging URL: https://my-project-staging.vercel.app

🗄️ 資料庫 / 後端服務
- Notion 資料庫: https://notion.so/xxxxx
- Supabase: https://app.supabase.com/project/xxxxx
- API Endpoint: https://api.my-project.com/v1

🔑 憑證位置（只記「去哪取得」，絕不記內容）
- Notion Token: https://notion.so/my-integrations → claude-handover
- Vercel Token: https://vercel.com/account/tokens
- .env 檔: ~/.claude/skills/handover/.env

📝 重要檔案
- 主要進入點: src/index.ts
- CI/CD: .github/workflows/deploy.yml
```

**Rules:**
- **Carry forward** the previous `project_links` as-is when creating a new handover
- **Update** when paths, URLs, or credentials change during the session
- **Only record paths and locations** — never record actual tokens, passwords, or secrets
- For credentials: record **where to get it** (URL or file path) and **the integration/key name**, not the value itself
- If no meaningful links exist for the project, set to null

#### First handover for a project

If no previous handover exists for this project:
- `key_decisions`: Extract any major decisions from the current session (or null if none)
- `active_context`: Summarize current state from the conversation
- `roadmap`: If a development plan was discussed, capture it; otherwise null
- `project_links`: Collect any paths, URLs, or credential sources mentioned in the conversation; otherwise null

### Step 3: Identify the project (project_id + project_name)

Every project has two names:
- `project_id` (slug): machine-readable unique ID. Lowercase, hyphens, no spaces/Chinese. Used for `--project=` queries.
- `project_name` (中文): human-readable display name. Shown in Notion Title as `【project_name】topic`.

**`project_id` format**: `lowercase-slug-YYMMDD` where YYMMDD is the project start date.
Examples: `handover-skill-260416`, `gmail-scanner-260320`, `my-portfolio-260101`

**Naming convention**: The `project_id` should be consistent across:
- Local folder name: `project_name(project_id)` (e.g., `交班單系統(handover-skill-260416)`)
- Git repo name: `project_id` (e.g., `handover-skill-260416`)
- Claude Code session title: `project_name(project_id)`
- Handover records: both `project_id` and `project_name` are stored

**Auto-detection**:
1. Check if there's a git repo: run `basename $(git rev-parse --show-toplevel 2>/dev/null) 2>/dev/null`
2. If no git repo, check the current directory name. If it follows the `中文名(slug)` pattern, extract the slug as `project_id` and the Chinese part as `project_name`.
3. If the directory name is generic (home, src, tmp, Desktop, etc.), ask the user

**First handover for a project**: ask the user for both `project_id` and `project_name`.
The `project_id` should include the project start date in YYMMDD format as a suffix.
Example prompt:
> 偵測到專案目錄為 `交班單系統(handover-skill-260416)`
> project_id: `handover-skill-260416` | project_name: `交班單系統`
> 主題: Notion 後端遷移
> 確認儲存？

**Subsequent handovers**: carry forward `project_name` from the previous handover for the same `project_id`. Check with:
```bash
node ~/.claude/skills/handover/scripts/resume.mjs --project=<project_id>
```
Use the returned `project_name` field. If it's null (old record without project_name), ask the user to provide one.

### Step 4: Auto-detect environment (Layer 2)

Run these commands and include results:
```bash
hostname                                    # → device
pwd                                         # → working_dir
git branch --show-current 2>/dev/null       # → git_branch
git rev-parse --short HEAD 2>/dev/null      # → git_commit
```

Optional fields (include if available):
- `test_status`: "passing" / "failing" / "untested" — check recent test output in conversation
- `open_files`: Array of files that were being edited
- `env_notes`: Any environment-specific notes (e.g., "need to source .env first")

### Step 5: Preview and confirm before saving

**IMPORTANT**: Before writing to the database, show the user a full preview of the handover note and ask for confirmation. This prevents AI summarization errors from being silently persisted.

Display the preview in this format:

```
📋 交班單預覽
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Session Type 說明：
  dev = 功能開發 | debug = 除錯排查 | discussion = 討論規劃 | admin = 行政雜務

Project: gmail-scan | Type: debug
Topic: Fix billing parser regex
Branch: feat/parser-fix (abc1234)

Accomplished（已完成事項）:
  - Found regex error in date pattern
  - Fixed extraction logic

Decisions（決策紀錄）:
  - Use lxml instead of BeautifulSoup for speed

Blocked（阻塞／卡關）:
  - API rate limit — need to wait 24h

Next Steps（下一步行動）:
  - Write unit tests
  - Deploy to staging

Attempted Approaches（嘗試過的方法）:
  - Tried regex v1 with \d{4}-\d{2} — failed on dates like 2026/04/12

Lessons Learned（學到的教訓）:
  - Gmail API returns inconsistent date formats

Key Decisions（關鍵決策．累積）:
  - [2026-04-10] Chose JWT with RS256 for cross-service auth
  - [2026-04-12] Use lxml over BeautifulSoup for speed

Active Context（當前工作狀態）:
  Currently fixing billing parser regex. Blocked by API rate limit
  until 2026-04-13. Next: write unit tests, deploy to staging.

Roadmap（開發路線圖）:
  Phase 1 [DONE]: MVP — handover + resume + SKILL.md
  >>> Phase 2 [IN PROGRESS]: 環境層自動偵測 + 正規化
  Phase 3: 多 Agent 整合 + 進階功能

Project Links（專案環境與路徑總覽）:
  📁 本地環境
  - 工作目錄: /c/Users/user/gmail-scan
  🗄️ 資料庫
  - Notion: https://notion.so/xxxxx
  🔑 憑證位置
  - Notion Token: https://notion.so/my-integrations → gmail-integration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
確認儲存？(可以說「修改 xxx」來調整內容)
```

Wait for the user to:
- **Confirm** ("好", "OK", "存") → proceed to Step 5.5
- **Request changes** ("修改 topic", "把 xxx 加到 decisions") → update the data and re-preview
- **Cancel** ("取消", "不存") → abort without saving

### Step 5.5: Git push (before saving handover)

After the user confirms the handover preview, **check if the current directory is a git repo with uncommitted changes or unpushed commits**, and ask if they want to push before saving the handover:

1. Run `git status --porcelain 2>/dev/null` to check for uncommitted changes
2. Run `git log @{u}..HEAD --oneline 2>/dev/null` to check for unpushed commits
3. If either has content, ask:
   > 偵測到尚未推送的變更，要先 git push 再儲存交班單嗎？

If the user says yes:
- If there are uncommitted changes, ask if they want to commit first (follow the normal git commit flow — stage, commit message, commit)
- Then run `git push`
- Record the final `git_commit` hash into the handover data

If the user says no or if there's no git repo / no changes:
- Skip and proceed to Step 6

**Important**: This step ensures the handover's `git_commit` field reflects the latest pushed state, so the next person can checkout the exact code state.

### Step 6: Write to database

Construct a JSON object with all fields, then pipe to the handover script:

```bash
echo '<json>' | node ~/.claude/skills/handover/scripts/handover.mjs
```

**Project name normalization**: The script automatically normalizes the project name (lowercase, trim whitespace, replace spaces with hyphens). So "Gmail Scan", "gmail-scan", and "GMAIL_SCAN" all become `gmail-scan`.

The JSON must match this schema:
```json
{
  "project": "gmail-scan",
  "topic": "Fix billing parser regex",
  "session_type": "debug",
  "accomplished": ["Found regex error in date pattern", "Fixed extraction logic"],
  "decisions": ["Use lxml instead of BeautifulSoup for speed"],
  "blocked": ["API rate limit — need to wait 24h"],
  "next_steps": ["Write unit tests", "Deploy to staging"],
  "attempted_approaches": ["Tried regex v1 with \\d{4}-\\d{2} — failed on dates like 2026/04/12"],
  "lessons_learned": ["Gmail API returns inconsistent date formats"],
  "conversation_summary": "Debugged billing parser...",
  "device": "LAPTOP-XYZ",
  "working_dir": "/c/Users/user/gmail-scan",
  "git_branch": "feat/parser-fix",
  "git_commit": "abc1234",
  "test_status": "passing",
  "open_files": ["parser.js", "test/parser.test.js"],
  "env_notes": null,
  "key_decisions": "- [2026-04-10] Chose JWT with RS256 for cross-service auth\n- [2026-04-12] Use lxml over BeautifulSoup for speed",
  "active_context": "Currently fixing billing parser regex. Blocked by API rate limit until 2026-04-13. Next: write unit tests, deploy to staging.",
  "roadmap": "Phase 1 [DONE]: MVP\n>>> Phase 2 [IN PROGRESS]: 環境層自動偵測\nPhase 3: 多 Agent 整合",
  "project_links": "📁 本地環境\n- 工作目錄: /c/Users/user/gmail-scan\n\n🗄️ 資料庫\n- Notion: https://notion.so/xxxxx\n\n🔑 憑證位置\n- Notion Token: https://notion.so/my-integrations → gmail-scan-integration"
}
```

The script returns: `{ "ok": true, "id": 1, "project": "gmail-scan", "topic": "..." }`

### Step 7: Confirm to user

Show a summary:
> Handover #1 saved
> Project: gmail-scan | Type: debug | Branch: feat/parser-fix
> Topic: Fix billing parser regex
> Next steps: Write unit tests, Deploy to staging

---

## /resume [query]

Resume work from a previous handover note.

### Query modes

| Usage | Behavior |
|-------|----------|
| `/resume` (no args) | Call `list.mjs` first, show recent handovers, let user pick |
| `/resume 5` | Load handover by ID |
| `/resume auth` | Search by topic (fuzzy match) |
| `/resume --project=gmail-scan` | Latest handover for that project |
| `/resume --project=gmail-scan parser` | Search within a specific project |

### Script calls

**List (when no args):**
```bash
node ~/.claude/skills/handover/scripts/list.mjs
```

**Resume with query:**
```bash
node ~/.claude/skills/handover/scripts/resume.mjs [--project=xxx] [query]
```

### Format the context block

After receiving the JSON from `resume.mjs`, format it as a structured context block.

**Same environment** (device matches current hostname): show Layer 1 + Layer 2:

```
=== HANDOVER CONTEXT (ID: {id}, {created_at}) ===
Project: {project} | Type: {session_type}
Topic: {topic}
Device: {device} | Branch: {git_branch} ({git_commit}) | Dir: {working_dir}

## Accomplished（已完成事項）
- {each item}

## Decisions（決策紀錄）
- {each item with rationale}

## Blocked（阻塞／卡關）
- {each item}

## Next Steps（下一步行動）
- [ ] {each item}

## Attempted Approaches（嘗試過的方法）
- {each item with outcome}

## Lessons Learned（學到的教訓）
- {each item}

## Conversation Summary（對話摘要）
{conversation_summary}

## Key Decisions（關鍵決策．累積）
{key_decisions — show full content, this is the permanent project memory}

## Active Context（當前工作狀態）
{active_context — current project state}

## Roadmap（開發路線圖）
{roadmap — full development plan with current progress indicator}

## Project Links（專案環境與路徑總覽）
{project_links}

## Environment Notes（環境備註）
Test status: {test_status} | Files: {open_files}
{env_notes}
===================================================
```

**Cross-environment** (different device or pasting to another AI): show Layer 1 only, omit Layer 2 fields.

### After injecting context

Briefly summarize what was handed over and ask if the user wants to continue with the next steps, or if they have a different focus.

---

## /list [--project=xxx] [--search=xxx]

List recent handover records.

```bash
node ~/.claude/skills/handover/scripts/list.mjs [--project=xxx] [--search=xxx] [--limit=N]
```

### Modes

| Usage | Behavior |
|-------|----------|
| `/list` | List all recent handovers + show all known projects |
| `/list --project=gmail-scan` | List handovers for exact project (normalized) |
| `/list --search=gmail` | **Fuzzy project search** — find projects containing "gmail" |

### Fuzzy project search

When the user can't remember the exact project name, use `--search=`:
- `/list --search=gmail` → finds `gmail-scan`, `gmail-billing`, etc.
- `/list --search=auth` → finds `auth-system`, `oauth-migration`, etc.

The script returns `matched_projects` array showing which projects matched, making it easy to pick the right one.

### Output format

When listing all (no filter), the output includes a project summary:

```
Known projects:
  gmail-scan (5 handovers, last: 2026-04-12)
  auth-system (3 handovers, last: 2026-04-11)

| ID | Date       | Project     | Topic                  | Type  |
|----|------------|-------------|------------------------|-------|
| 5  | 2026-04-12 | gmail-scan  | Fix parser regex       | debug |
| 4  | 2026-04-11 | auth-system | Add JWT refresh tokens | dev   |
| 3  | 2026-04-10 | gmail-scan  | Setup email ingestion  | dev   |
```

When using `--search=`, also show the matched projects:

```
Search "gmail" matched projects: gmail-scan, gmail-billing

| ID | Date       | Project      | Topic                  | Type  |
|----|------------|--------------|------------------------|-------|
| 5  | 2026-04-12 | gmail-scan   | Fix parser regex       | debug |
| 2  | 2026-04-09 | gmail-billing| Setup invoice parser   | dev   |
```

---

## Cross-Agent Usage

Layer 1 data is designed to be universal. When the user wants to continue work in a different AI (Gemini, GPT, etc.):

1. Use `/resume` to load the handover
2. Format as Layer 1 only (no environment-specific fields)
3. The user can copy-paste this block into the other AI's context

---

## Proactive Suggestions

Suggest `/handover` when:
- The user says they're stopping: "我要先停了", "that's it for now", "I'll continue later"
- The conversation has been long and productive (significant work done)
- The user is about to switch contexts: "let me switch to...", "在另一台機器上..."
- Context is getting long and there's risk of losing track

Suggest `/resume` when:
- The user starts a new conversation mentioning continuing previous work
- The user references a project they've worked on before
- The user seems to be re-explaining context that might be in a handover note
