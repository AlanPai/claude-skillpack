// List handover notes from Notion.
// Supports --project=xxx (exact), --search=xxx (fuzzy project match), --limit=N.

import {
  assertEnv, getDbId, notionFetch, normalizeProject, pageToRow,
} from './notion.mjs';

assertEnv();

// Parse args
let project = null;
let search = null;
let limit = 20;

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--project=')) {
    project = normalizeProject(arg.slice('--project='.length));
  } else if (arg.startsWith('--search=')) {
    search = arg.slice('--search='.length).trim().toLowerCase();
  } else if (arg.startsWith('--limit=')) {
    limit = Math.min(100, Math.max(1, Number(arg.slice('--limit='.length)) || 20));
  }
}

// Fetch ALL pages from the database (handles pagination). The Notion filter API
// for `contains` on rich_text is case-sensitive and can miss matches, so for
// `--search` (fuzzy project) we pull everything and filter in memory. This is
// fine for the expected data volume (dozens to low hundreds of handovers).
async function fetchAllPages(filter) {
  const all = [];
  let cursor;
  do {
    const body = {
      sorts: [{ property: 'Created', direction: 'descending' }],
      page_size: 100,
    };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    const res = await notionFetch(`/databases/${getDbId()}/query`, { method: 'POST', body });
    all.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return all;
}

try {
  if (search) {
    // Fuzzy project search — pull everything, filter in memory by project substring
    const pages = await fetchAllPages();
    const rows = pages.map(pageToRow);
    // Search both project_id (slug) and project_name (Chinese) for better discoverability
    const matched = rows.filter(r =>
      (r.project || '').toLowerCase().includes(search) ||
      (r.project_name || '').toLowerCase().includes(search)
    );
    const projects = [...new Set(matched.map(r => r.project).filter(Boolean))].sort();

    console.log(JSON.stringify({
      ok: true,
      search_term: search,
      matched_projects: projects,
      count: matched.length,
      handovers: matched.slice(0, limit).map(r => ({
        id: r.id,
        created_at: r.created_at,
        project: r.project,
        project_name: r.project_name,
        topic: r.topic,
        session_type: r.session_type,
        url: r.url,
      })),
    }));
  } else if (project) {
    // Exact project filter via API
    const pages = await fetchAllPages({
      property: 'Project',
      rich_text: { equals: project },
    });
    const rows = pages.slice(0, limit).map(pageToRow).map(r => ({
      id: r.id,
      created_at: r.created_at,
      project: r.project,
      project_name: r.project_name,
      topic: r.topic,
      session_type: r.session_type,
      url: r.url,
    }));
    console.log(JSON.stringify({ ok: true, count: rows.length, handovers: rows }));
  } else {
    // List all + summarize projects
    const pages = await fetchAllPages();
    const allRows = pages.map(pageToRow);

    // Build project summary (count + last handover date + display name)
    const projMap = new Map();
    for (const r of allRows) {
      if (!r.project) continue;
      const existing = projMap.get(r.project);
      if (!existing) {
        projMap.set(r.project, {
          project: r.project,
          project_name: r.project_name || null,
          count: 1,
          last_handover: r.created_at,
        });
      } else {
        existing.count++;
        if (r.project_name && !existing.project_name) existing.project_name = r.project_name;
        if (r.created_at > existing.last_handover) existing.last_handover = r.created_at;
      }
    }
    const projects = [...projMap.values()].sort(
      (a, b) => (b.last_handover || '').localeCompare(a.last_handover || '')
    );

    const rows = allRows.slice(0, limit).map(r => ({
      id: r.id,
      created_at: r.created_at,
      project: r.project,
      project_name: r.project_name,
      topic: r.topic,
      session_type: r.session_type,
      url: r.url,
    }));
    console.log(JSON.stringify({ ok: true, count: rows.length, projects, handovers: rows }));
  }
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}
