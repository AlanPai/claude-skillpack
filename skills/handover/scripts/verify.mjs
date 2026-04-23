#!/usr/bin/env node
// Verify Notion credentials and DB schema for the handover skill.
// Mirrored to AlanPai/claude-skillpack via GitHub Actions on push to main.
//
// Usage:
//   As library: import { verify } from './verify.mjs'
//   As CLI:     node verify.mjs [--token=xxx --db=yyy]
//               (falls back to env / .env file if flags omitted)
//
// Output (JSON to stdout):
//   {
//     ok: boolean,
//     checks: {
//       tokenFormat: { ok, message },
//       tokenValid:  { ok, message },
//       dbExists:    { ok, message },
//       dbAccess:    { ok, message },
//       schema:      { ok, missing: [], extra: [] }
//     },
//     hint: "first-failure actionable advice" | null
//   }

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Expected schema (must stay in sync with notion-schema.mjs HANDOVER_SCHEMA).
// Only property NAMES are checked here; full type comparison is the schema
// library's job.
const EXPECTED_PROPERTIES = [
  'Topic',
  'Project',
  'Session Type',
  'Device',
  'Working Dir',
  'Git Branch',
  'Git Commit',
  'Test Status',
  'Created',
  // Project Name is optional (backward-compat); we don't fail if missing
];
const OPTIONAL_PROPERTIES = ['Project Name'];

const TOKEN_RE = /^(ntn_|secret_)[A-Za-z0-9_-]{30,}$/;

// --- Env/file loading (same convention as notion.mjs) ---
function loadEnvFile() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, '..', '.env');
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

// --- Helpers ---
function extractDbId(raw) {
  if (!raw) return null;
  // Accept: bare 32-char hex, UUID with dashes, or full Notion URL
  const s = String(raw).trim();
  // Full URL form: https://www.notion.so/<workspace>/<name>-<32hex>?...
  const urlMatch = s.match(/([0-9a-fA-F]{32})/);
  if (urlMatch) return urlMatch[1];
  // UUID form: 8-4-4-4-12 hex
  const uuidMatch = s.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
  if (uuidMatch) return uuidMatch[1].replace(/-/g, '');
  return null;
}

async function notionGet(path, token) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// --- Main verification logic ---
export async function verify({ token, dbId } = {}) {
  const result = {
    ok: false,
    checks: {
      tokenFormat: { ok: false, message: '' },
      tokenValid:  { ok: false, message: '' },
      dbExists:    { ok: false, message: '' },
      dbAccess:    { ok: false, message: '' },
      schema:      { ok: false, missing: [], extra: [] },
    },
    hint: null,
  };

  // Step 1: tokenFormat
  if (!token) {
    result.checks.tokenFormat.message = 'Token is empty.';
    result.hint = 'Token 未提供。到 https://notion.so/my-integrations 取得 Internal Integration Token（ntn_ 或 secret_ 開頭）。';
    return result;
  }
  if (!TOKEN_RE.test(token)) {
    result.checks.tokenFormat.message = `Token format invalid. Expected prefix 'ntn_' or 'secret_'.`;
    result.hint = 'Token 格式不正確。正確格式開頭為 ntn_ 或 secret_，從 https://notion.so/my-integrations 取得。';
    return result;
  }
  result.checks.tokenFormat.ok = true;
  result.checks.tokenFormat.message = 'Token format OK.';

  // Step 2: tokenValid (API reachable)
  let me;
  try {
    me = await notionGet('/users/me', token);
  } catch (e) {
    result.checks.tokenValid.message = `Network error: ${e.message}`;
    result.hint = `無法連到 Notion API（${e.message}）。檢查網路連線。`;
    return result;
  }
  if (me.status === 401) {
    result.checks.tokenValid.message = 'Token rejected by Notion (401 Unauthorized).';
    result.hint = 'Token 無效或已失效。到 https://notion.so/my-integrations 確認或重新產一個。';
    return result;
  }
  if (me.status !== 200) {
    result.checks.tokenValid.message = `Unexpected status ${me.status}: ${me.data?.message || 'unknown error'}`;
    result.hint = `Notion API 回應異常（${me.status}）。稍後再試或到 status.notion.so 看服務狀態。`;
    return result;
  }
  result.checks.tokenValid.ok = true;
  result.checks.tokenValid.message = `Token valid. Bot: ${me.data?.name || me.data?.bot?.owner?.type || 'unknown'}`;

  // Step 3: dbExists
  const cleanId = extractDbId(dbId);
  if (!cleanId) {
    result.checks.dbExists.message = 'DB ID is empty or malformed.';
    result.hint = 'DB ID 為空或格式錯誤。貼 32 字元 hex、UUID，或完整的 Notion DB URL 都可以。';
    return result;
  }
  const db = await notionGet(`/databases/${cleanId}`, token);
  if (db.status === 404) {
    result.checks.dbExists.message = `DB not found (404). ID: ${cleanId}`;
    result.hint = `找不到 DB ID ${cleanId}。可能原因：(1) DB ID 錯了 (2) integration 沒被加入這個 DB 的 Connections。到 DB 頁面 → ⋯ → Connections → 加入你的 integration。`;
    return result;
  }
  if (db.status !== 200) {
    result.checks.dbExists.message = `Status ${db.status}: ${db.data?.message || 'unknown'}`;
    result.hint = `存取 DB 失敗（${db.status}）：${db.data?.message || ''}`;
    return result;
  }
  result.checks.dbExists.ok = true;
  result.checks.dbExists.message = `DB found: "${db.data?.title?.[0]?.plain_text || '(untitled)'}"`;

  // Step 4: dbAccess (has properties means we can read schema)
  if (!db.data?.properties || typeof db.data.properties !== 'object') {
    result.checks.dbAccess.message = 'DB response missing properties.';
    result.hint = 'Integration 讀不到 DB schema。通常是 Connections 還沒加 — DB 頁面 → ⋯ → Connections → 加入 integration。';
    return result;
  }
  result.checks.dbAccess.ok = true;
  result.checks.dbAccess.message = `Integration has access. ${Object.keys(db.data.properties).length} properties visible.`;

  // Step 5: schema
  const actual = new Set(Object.keys(db.data.properties));
  const missing = EXPECTED_PROPERTIES.filter(p => !actual.has(p));
  const allExpected = new Set([...EXPECTED_PROPERTIES, ...OPTIONAL_PROPERTIES]);
  const extra = [...actual].filter(p => !allExpected.has(p));

  result.checks.schema.missing = missing;
  result.checks.schema.extra = extra;
  if (missing.length > 0) {
    result.checks.schema.ok = false;
    result.hint = `Schema 缺少必要欄位：${missing.join(', ')}。執行：node ~/.claude/skills/handover/scripts/setup-notion-schema.mjs --update 補齊。`;
    return result;
  }
  result.checks.schema.ok = true;

  result.ok = true;
  return result;
}

// --- CLI entry ---
function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('verify.mjs');
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  let token = args.token;
  let dbId = args.db || args['db-id'] || args.dbid;

  if (!token || !dbId) {
    const fileEnv = loadEnvFile();
    token ||= process.env.NOTION_HANDOVER_TOKEN || fileEnv.NOTION_HANDOVER_TOKEN;
    dbId  ||= process.env.NOTION_HANDOVER_DB_ID  || fileEnv.NOTION_HANDOVER_DB_ID;
  }

  const result = await verify({ token, dbId });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
