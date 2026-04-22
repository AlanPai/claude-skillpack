#!/usr/bin/env node
// CLI wrapper for one-off Notion schema maintenance.
// The actual logic lives in notion-schema.mjs (shared with setup.mjs wizard).
//
// Usage:
//   node setup-notion-schema.mjs --update
//       PATCH existing DB to add missing properties / rename title to "Topic".
//       Reads NOTION_HANDOVER_TOKEN / NOTION_HANDOVER_DB_ID from env or .env file.
//
//   node setup-notion-schema.mjs --diff
//       Print current vs expected schema without mutating.
//
//   node setup-notion-schema.mjs --create --page=<page-url-or-id> [--title="Name"]
//       Create a new DB under the given parent page.
//       Parent page must have your integration added to Connections.
//
//   node setup-notion-schema.mjs
//       (no args) Print usage and exit 1.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDatabase, updateDatabase, diffSchema } from './notion-schema.mjs';

// --- env/.env loading (same convention as notion.mjs) ---
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

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}

function usage() {
  console.error(`Usage:
  node setup-notion-schema.mjs --update
  node setup-notion-schema.mjs --diff
  node setup-notion-schema.mjs --create --page=<page-url-or-id> [--title="Name"]

Token/DB ID resolved from (in order): CLI flags, env vars, ~/.claude/skills/handover/.env`);
}

const args = parseArgs(process.argv.slice(2));
const fileEnv = loadEnvFile();
const token = args.token || process.env.NOTION_HANDOVER_TOKEN || fileEnv.NOTION_HANDOVER_TOKEN;
const dbId  = args.db   || process.env.NOTION_HANDOVER_DB_ID  || fileEnv.NOTION_HANDOVER_DB_ID;

const modes = ['update', 'diff', 'create'].filter(m => args[m]);
if (modes.length === 0) {
  usage();
  process.exit(1);
}
if (modes.length > 1) {
  console.error(`Only one mode at a time. Got: ${modes.join(', ')}`);
  process.exit(1);
}
const mode = modes[0];

if (!token) {
  console.error('Missing NOTION_HANDOVER_TOKEN (env, .env, or --token=...)');
  process.exit(1);
}

if (mode === 'update') {
  if (!dbId) { console.error('Missing NOTION_HANDOVER_DB_ID.'); process.exit(1); }
  const r = await updateDatabase({ token, dbId });
  if (!r.ok) {
    console.error(`ERROR: ${r.error}`);
    if (r.hint) console.error(`HINT:  ${r.hint}`);
    process.exit(1);
  }
  console.log('Schema updated. Properties now:');
  for (const p of r.properties) console.log(`  - ${p}`);
  process.exit(0);
}

if (mode === 'diff') {
  if (!dbId) { console.error('Missing NOTION_HANDOVER_DB_ID.'); process.exit(1); }
  const r = await diffSchema({ token, dbId });
  if (r.error) { console.error(`ERROR: ${r.error}`); process.exit(1); }
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

if (mode === 'create') {
  const page = args.page || args['parent-page'];
  if (!page) {
    console.error('--create requires --page=<page-url-or-id>');
    process.exit(1);
  }
  const r = await createDatabase({
    token,
    parentPageId: page,
    title: args.title || 'Claude Handovers',
  });
  if (!r.ok) {
    console.error(`ERROR: ${r.error}`);
    if (r.hint) console.error(`HINT:  ${r.hint}`);
    process.exit(1);
  }
  console.log(`Database created.`);
  console.log(`  ID:    ${r.dbId}`);
  console.log(`  Title: ${r.title}`);
  console.log(`\nNext: write this DB ID to ~/.claude/skills/handover/.env`);
  process.exit(0);
}
