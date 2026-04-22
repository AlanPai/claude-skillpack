// Shared Notion API client for handover skill.
// All scripts import from this module.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Credentials resolution order:
//   1. Process environment variables (NOTION_HANDOVER_TOKEN / NOTION_HANDOVER_DB_ID)
//   2. Fallback: ~/.claude/skills/handover/.env (simple KEY=VALUE format)
// The .env file ensures credentials survive across all Claude Code sessions
// regardless of the working directory or whether `setx` has propagated yet.
// It is listed in .gitignore so it won't leak if the skill dir is version-controlled.
function loadEnvFile() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, '..', '.env');
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    // Strip surrounding quotes if present
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

const fileEnv = loadEnvFile();
const TOKEN = process.env.NOTION_HANDOVER_TOKEN || fileEnv.NOTION_HANDOVER_TOKEN;
const DB_ID = process.env.NOTION_HANDOVER_DB_ID || fileEnv.NOTION_HANDOVER_DB_ID;

// Check for the "disabled" marker file. When present, the skill is intentionally
// opted out on this device (Mode C in the setup wizard). assertEnv() returns
// a `disabled: true` payload and exits 0 (not an error) so callers can
// distinguish "user chose to skip" from "user forgot to configure".
function isDisabled() {
  const here = dirname(fileURLToPath(import.meta.url));
  return existsSync(join(here, '..', '.env.disabled'));
}

export function assertEnv() {
  if (isDisabled()) {
    console.log(JSON.stringify({
      ok: false,
      disabled: true,
      message: "Handover is disabled on this device. Run: node ~/.claude/skills/handover/scripts/setup.mjs to re-enable.",
    }));
    // Intentionally exit 0: "disabled" is a user choice, not a failure.
    process.exit(0);
  }
  if (!TOKEN || !DB_ID) {
    console.error(JSON.stringify({
      ok: false,
      error: "Missing NOTION_HANDOVER_TOKEN or NOTION_HANDOVER_DB_ID environment variables",
      hint: "Run the setup wizard: node ~/.claude/skills/handover/scripts/setup.mjs",
    }));
    process.exit(1);
  }
}

export function getDbId() {
  return DB_ID;
}

const BASE = "https://api.notion.com/v1";
const HEADERS = () => ({
  "Authorization": `Bearer ${TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
});

export async function notionFetch(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.object === "error") {
    throw new Error(`Notion API error: ${data.code} — ${data.message}`);
  }
  return data;
}

// Normalize project name the same way the old SQLite backend did.
export function normalizeProject(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, "-");
}

// ---- Property builders ----
export const prop = {
  title: (text) => ({ title: [{ text: { content: String(text || "").slice(0, 2000) } }] }),
  richText: (text) => text == null || text === ""
    ? { rich_text: [] }
    : { rich_text: [{ text: { content: String(text).slice(0, 2000) } }] },
  select: (name) => name == null || name === ""
    ? { select: null }
    : { select: { name: String(name) } },
  date: (iso) => iso == null
    ? { date: null }
    : { date: { start: iso } },
};

// ---- Property readers ----
export const read = {
  title: (p) => p?.title?.[0]?.plain_text || "",
  richText: (p) => (p?.rich_text || []).map(t => t.plain_text).join(""),
  select: (p) => p?.select?.name || null,
  date: (p) => p?.date?.start || null,
};

// ---- Block builders for page body ----
// Notion rich_text has a 2000-char per-text-object limit, so we chunk long strings.
function chunkText(s, size = 1900) {
  const out = [];
  const str = String(s);
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}

function textRuns(s) {
  if (s == null || s === "") return [];
  return chunkText(s).map(content => ({ type: "text", text: { content } }));
}

export const block = {
  heading2: (text) => ({
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ type: "text", text: { content: String(text) } }] },
  }),
  paragraph: (text) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: textRuns(text) },
  }),
  bullet: (text) => ({
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: textRuns(text) },
  }),
  todo: (text, checked = false) => ({
    object: "block",
    type: "to_do",
    to_do: { rich_text: textRuns(text), checked },
  }),
};

// Build all the content blocks for a handover note's page body.
// Order mirrors the resume.mjs context block so the Notion page reads top-to-bottom the same way.
export function buildHandoverBlocks(data) {
  const blocks = [];
  const section = (title, items, renderer = block.bullet) => {
    if (!items || (Array.isArray(items) && items.length === 0)) return;
    blocks.push(block.heading2(title));
    if (Array.isArray(items)) {
      for (const item of items) blocks.push(renderer(item));
    } else {
      blocks.push(block.paragraph(items));
    }
  };

  section("Accomplished（已完成事項）", data.accomplished);
  section("Decisions（決策紀錄）", data.decisions);
  section("Blocked（阻塞／卡關）", data.blocked);
  if (Array.isArray(data.next_steps) && data.next_steps.length) {
    blocks.push(block.heading2("Next Steps（下一步行動）"));
    for (const s of data.next_steps) blocks.push(block.todo(s, false));
  }
  section("Attempted Approaches（嘗試過的方法）", data.attempted_approaches);
  section("Lessons Learned（學到的教訓）", data.lessons_learned);

  if (data.conversation_summary) {
    blocks.push(block.heading2("Conversation Summary（對話摘要）"));
    blocks.push(block.paragraph(data.conversation_summary));
  }
  if (data.key_decisions) {
    blocks.push(block.heading2("Key Decisions（關鍵決策．累積）"));
    blocks.push(block.paragraph(data.key_decisions));
  }
  if (data.active_context) {
    blocks.push(block.heading2("Active Context（當前工作狀態）"));
    blocks.push(block.paragraph(data.active_context));
  }
  if (data.roadmap) {
    blocks.push(block.heading2("Roadmap（開發路線圖）"));
    blocks.push(block.paragraph(data.roadmap));
  }
  if (data.project_links) {
    blocks.push(block.heading2("Project Links（專案環境與路徑總覽）"));
    blocks.push(block.paragraph(data.project_links));
  }

  if (data.env_notes || (data.open_files && data.open_files.length)) {
    blocks.push(block.heading2("Environment Notes（環境備註）"));
    if (data.env_notes) blocks.push(block.paragraph(data.env_notes));
    if (Array.isArray(data.open_files) && data.open_files.length) {
      for (const f of data.open_files) blocks.push(block.bullet(f));
    }
  }

  return blocks;
}

// Parse page body blocks back into structured handover fields.
// We use heading_2 blocks as section markers and collect everything under them.
export function parseHandoverBlocks(blocks) {
  const result = {
    accomplished: [], decisions: [], blocked: [], next_steps: [],
    attempted_approaches: [], lessons_learned: [],
    conversation_summary: null, key_decisions: null, active_context: null,
    roadmap: null, project_links: null, env_notes: null, open_files: [],
  };
  // Maps heading text → field name. Includes both old (English-only) and new
  // (English + Chinese) heading formats for backward compatibility.
  const sectionMap = {
    // New bilingual headings
    "Accomplished（已完成事項）": "accomplished",
    "Decisions（決策紀錄）": "decisions",
    "Blocked（阻塞／卡關）": "blocked",
    "Next Steps（下一步行動）": "next_steps",
    "Attempted Approaches（嘗試過的方法）": "attempted_approaches",
    "Lessons Learned（學到的教訓）": "lessons_learned",
    "Conversation Summary（對話摘要）": "conversation_summary",
    "Key Decisions（關鍵決策．累積）": "key_decisions",
    "Active Context（當前工作狀態）": "active_context",
    "Roadmap（開發路線圖）": "roadmap",
    "Project Links（專案環境與路徑總覽）": "project_links",
    "Environment Notes（環境備註）": "env_notes",
    // Old English-only headings (backward compat)
    "Accomplished": "accomplished",
    "Decisions": "decisions",
    "Blocked": "blocked",
    "Next Steps": "next_steps",
    "Attempted Approaches": "attempted_approaches",
    "Lessons Learned": "lessons_learned",
    "Conversation Summary": "conversation_summary",
    "Key Decisions (Cumulative)": "key_decisions",
    "Active Context": "active_context",
    "Roadmap": "roadmap",
    "Project Links": "project_links",
    "Environment Notes": "env_notes",
  };
  const textSections = new Set([
    "conversation_summary", "key_decisions", "active_context", "roadmap", "project_links", "env_notes",
  ]);

  let current = null;
  for (const b of blocks) {
    if (b.type === "heading_2") {
      const title = (b.heading_2.rich_text || []).map(t => t.plain_text).join("");
      current = sectionMap[title] || null;
      continue;
    }
    if (!current) continue;

    const text = (() => {
      if (b.type === "bulleted_list_item") return (b.bulleted_list_item.rich_text || []).map(t => t.plain_text).join("");
      if (b.type === "to_do") return (b.to_do.rich_text || []).map(t => t.plain_text).join("");
      if (b.type === "paragraph") return (b.paragraph.rich_text || []).map(t => t.plain_text).join("");
      return "";
    })();
    if (!text) continue;

    if (textSections.has(current)) {
      // For Environment Notes, a bulleted_list_item is an open_files entry, not the env_notes body.
      if (current === "env_notes" && b.type === "bulleted_list_item") {
        result.open_files.push(text);
      } else {
        result[current] = result[current] ? result[current] + "\n" + text : text;
      }
    } else {
      result[current].push(text);
    }
  }
  // Normalize empty arrays to null for cleaner output parity with old SQLite backend.
  for (const k of ["blocked"]) {
    if (Array.isArray(result[k]) && result[k].length === 0) result[k] = null;
  }
  return result;
}

// Fetch ALL blocks for a page (handles pagination).
export async function fetchPageBlocks(pageId) {
  const all = [];
  let cursor;
  do {
    const qs = cursor ? `?start_cursor=${cursor}` : "";
    const data = await notionFetch(`/blocks/${pageId}/children${qs}`);
    all.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return all;
}

// Convert a Notion page object to the Layer-2 handover row shape.
export function pageToRow(page) {
  const p = page.properties;
  return {
    id: page.id,
    created_at: read.date(p["Created"]) || page.created_time,
    project: read.richText(p["Project"]),
    topic: read.title(p["Topic"]),
    session_type: read.select(p["Session Type"]),
    device: read.richText(p["Device"]),
    working_dir: read.richText(p["Working Dir"]),
    git_branch: read.richText(p["Git Branch"]) || null,
    git_commit: read.richText(p["Git Commit"]) || null,
    test_status: read.select(p["Test Status"]),
    project_name: read.richText(p["Project Name"]) || null,
    url: page.url,
  };
}
