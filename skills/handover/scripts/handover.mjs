// Write a handover note to Notion.
// Reads JSON from stdin, creates a database page, returns { ok, id, url, ... }.

import {
  assertEnv, getDbId, notionFetch, normalizeProject,
  prop, buildHandoverBlocks,
} from './notion.mjs';

assertEnv();

let input = '';
for await (const chunk of process.stdin) input += chunk;

try {
  const data = JSON.parse(input);

  if (!data.topic) {
    console.log(JSON.stringify({ ok: false, error: 'Missing required field: topic' }));
    process.exit(1);
  }

  const project = normalizeProject(data.project);
  const projectName = data.project_name || null;
  const sessionType = data.session_type || 'dev';
  const nowIso = new Date().toISOString();

  // Title format: 【中文專案名】主題  (if project_name exists)
  //               主題               (if no project_name)
  const titleText = projectName
    ? `【${projectName}】${data.topic}`
    : data.topic;

  // Build page properties (short, filterable fields)
  const properties = {
    "Topic":        prop.title(titleText),
    "Project":      prop.richText(project),
    "Project Name": prop.richText(projectName),
    "Session Type": prop.select(sessionType),
    "Device":       prop.richText(data.device),
    "Working Dir":  prop.richText(data.working_dir),
    "Git Branch":   prop.richText(data.git_branch),
    "Git Commit":   prop.richText(data.git_commit),
    "Test Status":  prop.select(data.test_status),
    "Created":      prop.date(nowIso),
  };

  // Build page body blocks (long text fields)
  const children = buildHandoverBlocks(data);

  const created = await notionFetch('/pages', {
    method: 'POST',
    body: {
      parent: { database_id: getDbId() },
      properties,
      children,
    },
  });

  console.log(JSON.stringify({
    ok: true,
    id: created.id,
    url: created.url,
    project,
    project_name: projectName,
    topic: data.topic,
    session_type: sessionType,
  }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}
