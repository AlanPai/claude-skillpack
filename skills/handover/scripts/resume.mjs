// Resume a handover note from Notion.
// Supports: by ID, by --project=xxx, by topic query (fuzzy), or most recent.

import {
  assertEnv, getDbId, notionFetch, normalizeProject,
  fetchPageBlocks, parseHandoverBlocks, pageToRow,
} from './notion.mjs';

assertEnv();

// Parse args
let project = null;
let query = null;

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--project=')) {
    project = normalizeProject(arg.slice('--project='.length));
  } else if (!query) {
    query = arg;
  }
}

// Notion IDs are 32 hex chars (no dashes) or UUID form with dashes.
// A bare integer is NOT a valid ID — we accept it only for parity with the old SQLite backend
// and will treat it as a topic substring search instead.
const isNotionId = (s) => typeof s === 'string' && /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i.test(s);

try {
  let page;

  // Case 1: exact Notion page ID
  if (query && isNotionId(query)) {
    page = await notionFetch(`/pages/${query}`);
  } else {
    // Build filter
    const filters = [];
    if (project) {
      filters.push({ property: 'Project', rich_text: { equals: project } });
    }
    if (query) {
      filters.push({ property: 'Topic', title: { contains: query } });
    }

    const body = {
      sorts: [{ property: 'Created', direction: 'descending' }],
      page_size: 1,
    };
    if (filters.length === 1) body.filter = filters[0];
    else if (filters.length > 1) body.filter = { and: filters };

    const result = await notionFetch(`/databases/${getDbId()}/query`, {
      method: 'POST',
      body,
    });
    page = result.results[0];
  }

  if (!page) {
    console.log(JSON.stringify({ ok: false, error: 'No handover found' }));
    process.exit(1);
  }

  const row = pageToRow(page);
  const blocks = await fetchPageBlocks(page.id);
  const content = parseHandoverBlocks(blocks);

  console.log(JSON.stringify({
    ok: true,
    handover: { ...row, ...content },
  }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}
