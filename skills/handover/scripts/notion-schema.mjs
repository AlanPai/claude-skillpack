// Schema library for handover Notion database.
// Single source of truth for create / update / diff operations.
//
// Used by:
//   - setup-notion-schema.mjs (CLI wrapper — one-off maintenance)
//   - setup.mjs (interactive wizard — Mode B creates fresh DB)
//   - verify.mjs (consumes EXPECTED_PROPERTIES list indirectly)

// ---- Property definitions ----
// The "title" property is a Notion DB requirement (every DB has exactly one).
// On CREATE: include `Topic` as title.
// On UPDATE: the existing title property's Notion-assigned name may differ
//            (e.g. "名稱" if the DB was created through Notion UI in Chinese),
//            so the rename-to-"Topic" handling lives in updateDatabase() below.

export const NON_TITLE_PROPERTIES = {
  Project:       { rich_text: {} },
  'Session Type': {
    select: {
      options: [
        { name: 'dev',        color: 'blue'   },
        { name: 'debug',      color: 'red'    },
        { name: 'discussion', color: 'yellow' },
        { name: 'admin',      color: 'gray'   },
      ],
    },
  },
  Device:        { rich_text: {} },
  'Working Dir': { rich_text: {} },
  'Git Branch':  { rich_text: {} },
  'Git Commit':  { rich_text: {} },
  'Test Status': {
    select: {
      options: [
        { name: 'passing',  color: 'green' },
        { name: 'failing',  color: 'red'   },
        { name: 'untested', color: 'gray'  },
      ],
    },
  },
  Created:        { date: {} },
  'Project Name': { rich_text: {} },
};

// Full create-time schema: title property + rest
export const CREATE_SCHEMA = {
  Topic: { title: {} },
  ...NON_TITLE_PROPERTIES,
};

// List of properties considered REQUIRED for the handover skill to function.
// "Project Name" is optional (added later; older DBs might not have it).
export const REQUIRED_PROPERTY_NAMES = [
  'Topic', 'Project', 'Session Type', 'Device', 'Working Dir',
  'Git Branch', 'Git Commit', 'Test Status', 'Created',
];

// ---- Low-level Notion fetch helper ----
async function notionFetch(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ---- Public API ----

/**
 * Extract a 32-char hex ID from a Notion page/DB URL, UUID, or bare hex.
 */
export function extractId(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const hex32 = s.match(/([0-9a-fA-F]{32})/);
  if (hex32) return hex32[1];
  const uuid = s.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
  if (uuid) return uuid[1].replace(/-/g, '');
  return null;
}

/**
 * Create a brand-new database under a parent page.
 * Returns { ok, dbId?, title?, error?, hint? }.
 *
 * Requires: the integration must have been added to the parent page's Connections.
 */
export async function createDatabase({ token, parentPageId, title = 'Claude Handovers' }) {
  if (!token) return { ok: false, error: 'Token required.' };
  const pageId = extractId(parentPageId) || parentPageId;
  if (!pageId) return { ok: false, error: 'parentPageId invalid.' };

  const body = {
    parent: { type: 'page_id', page_id: pageId },
    title: [{ type: 'text', text: { content: title } }],
    properties: CREATE_SCHEMA,
  };

  const { status, data } = await notionFetch('/databases', { method: 'POST', body, token });

  if (status === 200 || status === 201) {
    return { ok: true, dbId: data.id, title: data.title?.[0]?.plain_text || title };
  }
  if (status === 404) {
    return {
      ok: false,
      status,
      error: data?.message || 'Parent page not found.',
      hint: 'Integration 對這個 page 沒有存取權。到該 Notion page → ⋯ → Connections → 加入你的 integration，然後再試一次。',
    };
  }
  return {
    ok: false,
    status,
    error: data?.message || `HTTP ${status}`,
    hint: `建立 DB 失敗（${status}）：${data?.message || ''}`,
  };
}

/**
 * PATCH an existing DB to add any missing properties / normalize title name.
 * Does NOT delete extra properties the user may have added.
 */
export async function updateDatabase({ token, dbId }) {
  if (!token || !dbId) return { ok: false, error: 'token and dbId required.' };
  const id = extractId(dbId) || dbId;

  // First read current schema to find the existing title property's name.
  const current = await notionFetch(`/databases/${id}`, { token });
  if (current.status !== 200) {
    return {
      ok: false,
      status: current.status,
      error: current.data?.message || `HTTP ${current.status}`,
      hint: current.status === 404
        ? 'DB 找不到，或 integration 沒有 Connections。到 DB 頁面 → ⋯ → Connections → 加入 integration。'
        : null,
    };
  }

  // Find the title property (there's exactly one per DB).
  const existingTitleName = Object.entries(current.data.properties || {})
    .find(([, def]) => def.type === 'title')?.[0];

  const patchProperties = { ...NON_TITLE_PROPERTIES };
  if (existingTitleName && existingTitleName !== 'Topic') {
    // Rename the title property to "Topic"
    patchProperties[existingTitleName] = { name: 'Topic', title: {} };
  } else if (!existingTitleName) {
    // Unusual: no title property. Add one (Notion will reject but surface clearly).
    patchProperties.Topic = { title: {} };
  }

  const { status, data } = await notionFetch(`/databases/${id}`, {
    method: 'PATCH',
    body: { properties: patchProperties },
    token,
  });
  if (status === 200) {
    return { ok: true, properties: Object.keys(data.properties || {}) };
  }
  return {
    ok: false,
    status,
    error: data?.message || `HTTP ${status}`,
    hint: `更新 schema 失敗（${status}）：${data?.message || ''}`,
  };
}

/**
 * Compare current DB schema against REQUIRED_PROPERTY_NAMES without mutating.
 * Returns { ok, missing: [], extra: [], properties: [] }.
 */
export async function diffSchema({ token, dbId }) {
  if (!token || !dbId) return { ok: false, error: 'token and dbId required.' };
  const id = extractId(dbId) || dbId;
  const { status, data } = await notionFetch(`/databases/${id}`, { token });
  if (status !== 200) {
    return { ok: false, status, error: data?.message || `HTTP ${status}` };
  }
  const actual = Object.keys(data.properties || {});
  const actualSet = new Set(actual);
  const missing = REQUIRED_PROPERTY_NAMES.filter(p => !actualSet.has(p));
  const allKnown = new Set([...REQUIRED_PROPERTY_NAMES, 'Project Name']);
  const extra = actual.filter(p => !allKnown.has(p));
  return {
    ok: missing.length === 0,
    missing,
    extra,
    properties: actual,
  };
}
