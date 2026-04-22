import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DB_PATH = join(homedir(), '.claude', 'skills', 'handover', 'handover.db');

export function getDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS handovers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      project TEXT,
      topic TEXT NOT NULL,
      session_type TEXT NOT NULL DEFAULT 'dev',
      accomplished TEXT,
      decisions TEXT,
      blocked TEXT,
      next_steps TEXT,
      attempted_approaches TEXT,
      lessons_learned TEXT,
      conversation_summary TEXT,
      device TEXT,
      working_dir TEXT,
      git_branch TEXT,
      git_commit TEXT,
      test_status TEXT,
      subscription_account TEXT,
      open_files TEXT,
      env_notes TEXT,
      key_decisions TEXT,
      active_context TEXT,
      roadmap TEXT
    )
  `);
  // Auto-migrate: add columns that may not exist in older databases
  const migrationColumns = [
    { name: 'key_decisions', type: 'TEXT' },
    { name: 'active_context', type: 'TEXT' },
    { name: 'roadmap', type: 'TEXT' },
  ];
  const existingCols = db.prepare("PRAGMA table_info(handovers)").all().map(c => c.name);
  for (const col of migrationColumns) {
    if (!existingCols.includes(col.name)) {
      db.exec(`ALTER TABLE handovers ADD COLUMN ${col.name} ${col.type}`);
    }
  }

  return db;
}

export function normalizeProject(name) {
  if (!name) return null;
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff\u3400-\u4dbf\-]/g, '') // keep alphanumeric, CJK, hyphens
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function serialize(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return JSON.stringify(v);
  return String(v);
}

export function deserializeRow(row) {
  if (!row) return null;
  const arrayFields = [
    'accomplished', 'decisions', 'blocked', 'next_steps',
    'attempted_approaches', 'lessons_learned', 'open_files'
  ];
  for (const f of arrayFields) {
    if (row[f]) {
      try { row[f] = JSON.parse(row[f]); } catch {}
    }
  }
  return row;
}
