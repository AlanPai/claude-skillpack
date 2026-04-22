#!/usr/bin/env node
// Interactive setup wizard for the handover skill.
//
// Three modes:
//   Mode A — Connect to existing Notion DB (paste token + DB ID → verify → write .env)
//   Mode B — Create a new Notion DB (guided flow: integration → parent page → create DB → write .env)
//   Mode C — Disable handover on this device (write .env.disabled marker)
//
// Usage:
//   node ~/.claude/skills/handover/scripts/setup.mjs

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { hostname } from 'node:os';
import { spawn } from 'node:child_process';
import { verify } from './verify.mjs';
import { createDatabase, extractId } from './notion-schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(HERE, '..');
const ENV_PATH = join(SKILL_DIR, '.env');
const DISABLED_PATH = join(SKILL_DIR, '.env.disabled');

// --- Colors (simple ANSI, no deps) ---
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const ok   = (s) => `${c.green}✓${c.reset} ${s}`;
const fail = (s) => `${c.red}✗${c.reset} ${s}`;
const info = (s) => `${c.cyan}i${c.reset} ${s}`;
const warn = (s) => `${c.yellow}!${c.reset} ${s}`;

// --- I/O ---
const rl = createInterface({ input: stdin, output: stdout });
const ask = (q) => rl.question(q);
async function askYN(q, defaultYes = true) {
  const hint = defaultYes ? '(Y/n)' : '(y/N)';
  const answer = (await ask(`${q} ${hint} `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

// --- Env file helpers ---
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
function writeEnv(token, dbId) {
  const content = `NOTION_HANDOVER_TOKEN=${token}\nNOTION_HANDOVER_DB_ID=${dbId}\n`;
  writeFileSync(ENV_PATH, content, { mode: 0o600 });
}

// --- Status snapshot ---
function snapshotStatus() {
  const disabled = existsSync(DISABLED_PATH);
  const env = loadEnvFile(ENV_PATH);
  const hasCreds = Boolean(env.NOTION_HANDOVER_TOKEN && env.NOTION_HANDOVER_DB_ID);
  let status;
  if (disabled) status = `${c.yellow}DISABLED${c.reset} (.env.disabled present)`;
  else if (hasCreds) status = `${c.green}ENABLED${c.reset}`;
  else status = `${c.red}NOT CONFIGURED${c.reset}`;
  return { disabled, hasCreds, env, status };
}

// --- Open URL in browser (best-effort) ---
function openUrl(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

// --- Verification output formatter ---
function printVerifyResult(result) {
  const names = ['tokenFormat', 'tokenValid', 'dbExists', 'dbAccess', 'schema'];
  for (const n of names) {
    const check = result.checks[n];
    const label = n.padEnd(12);
    if (check.ok) console.log(`  ${ok(label)} ${c.dim}${check.message || ''}${c.reset}`);
    else if (check.message) console.log(`  ${fail(label)} ${check.message}`);
    else console.log(`  ${c.gray}·${c.reset} ${c.gray}${label} (skipped)${c.reset}`);
  }
  if (result.hint) console.log(`\n${warn('HINT:')} ${result.hint}`);
}

// ============================================================
// Mode A — Connect to existing DB
// ============================================================
async function modeA() {
  console.log(`\n${c.bold}Mode A — 連到現有的 Notion DB${c.reset}`);
  console.log(c.dim + '提示：token 從 https://notion.so/my-integrations 取得；DB ID 可以貼完整 URL。' + c.reset);

  while (true) {
    const token = (await ask('\nNotion Integration Token: ')).trim();
    const dbRaw = (await ask('Notion DB ID 或 URL:      ')).trim();

    console.log('\n驗證中...');
    const result = await verify({ token, dbId: dbRaw });
    printVerifyResult(result);

    if (result.ok) {
      const dbId = extractId(dbRaw);
      writeEnv(token, dbId);
      console.log(`\n${ok('設定完成！')} 已寫入 ${c.dim}${ENV_PATH}${c.reset}`);
      // Remove stale disabled marker if present
      if (existsSync(DISABLED_PATH)) {
        unlinkSync(DISABLED_PATH);
        console.log(info('已自動移除 .env.disabled 標記檔（重新啟用）'));
      }
      return true;
    }

    const retry = await askYN('\n驗證失敗。重新輸入？', true);
    if (!retry) return false;
  }
}

// ============================================================
// Mode B — Create new DB (guided)
// ============================================================
async function modeB() {
  console.log(`\n${c.bold}Mode B — 從零建立 Notion DB${c.reset}`);
  console.log(c.dim + '這會帶你完成 4 個步驟：integration → 驗證 token → parent page → 建 DB\n' + c.reset);

  // Step 1: integration
  console.log(`${c.cyan}[1/4]${c.reset} Integration`);
  const hasIntegration = await askYN('你已經有 Notion integration 和 token 了嗎？', false);

  if (!hasIntegration) {
    console.log('\n請照以下步驟建立 integration：');
    console.log(`  1. 開啟 ${c.blue}https://notion.so/my-integrations${c.reset}`);
    console.log('  2. 按 "+ New integration"');
    console.log('  3. Name: claude-handover（或任意名稱）');
    console.log('  4. Associated workspace: 選你的 workspace');
    console.log('  5. Type: Internal → Submit');
    console.log('  6. 建立後，按 "Show" 複製 Internal Integration Secret');
    const opened = openUrl('https://notion.so/my-integrations');
    if (opened) console.log(info('已嘗試幫你開啟瀏覽器。'));
    await ask('\n完成後按 Enter 繼續...');
  }

  // Step 2: validate token
  console.log(`\n${c.cyan}[2/4]${c.reset} 驗證 token`);
  let token;
  while (true) {
    token = (await ask('貼上你的 Internal Integration Token: ')).trim();
    const r = await verify({ token, dbId: 'dummy-for-step-check' });
    // We only care that tokenFormat + tokenValid pass
    if (r.checks.tokenFormat.ok && r.checks.tokenValid.ok) {
      console.log(ok(`Token 驗證通過：${r.checks.tokenValid.message}`));
      break;
    }
    console.log(fail(r.hint || 'Token 驗證失敗'));
    const retry = await askYN('重試？', true);
    if (!retry) return false;
  }

  // Step 3: parent page
  console.log(`\n${c.cyan}[3/4]${c.reset} 建立 parent page`);
  console.log('請在 Notion 建一個 page 當 DB 的容器，並把 integration 加進該 page：');
  console.log('  1. 在 Notion 左側按 "+" 建立新 page（例：「Claude Tools」）');
  console.log('  2. 打開該 page → 右上 ⋯ → Connections → 搜尋你的 integration → 加入');
  console.log('  3. 複製該 page 的網址（右上「Share」→ Copy link）');

  let parentPageId;
  while (true) {
    const pageRaw = (await ask('\n貼上 page URL（或 page ID）：')).trim();
    parentPageId = extractId(pageRaw);
    if (!parentPageId) {
      console.log(fail('無法從輸入擷取 page ID。請貼完整 URL 或 32-字元 hex。'));
      continue;
    }
    // Sanity: try to fetch this page metadata
    const res = await fetch(`https://api.notion.com/v1/pages/${parentPageId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
    });
    if (res.status === 200) {
      console.log(ok('Integration 有這個 page 的存取權。'));
      break;
    }
    if (res.status === 404) {
      console.log(fail('Integration 在這個 page 上還沒被加入 Connections。請到該 page → ⋯ → Connections → 加入 integration。'));
    } else {
      const data = await res.json().catch(() => ({}));
      console.log(fail(`Status ${res.status}: ${data?.message || ''}`));
    }
    const retry = await askYN('加好 Connections 後重試？', true);
    if (!retry) return false;
  }

  // Step 4: create DB
  console.log(`\n${c.cyan}[4/4]${c.reset} 建立 database`);
  const title = (await ask('DB 名稱（預設：Claude Handovers）：')).trim() || 'Claude Handovers';

  console.log('建立中...');
  const created = await createDatabase({ token, parentPageId, title });
  if (!created.ok) {
    console.log(fail(`建立失敗：${created.error}`));
    if (created.hint) console.log(warn(created.hint));
    return false;
  }
  console.log(ok(`DB 建立成功：${created.title}`));
  console.log(c.dim + `  ID: ${created.dbId}` + c.reset);

  // Write .env
  const cleanDbId = extractId(created.dbId) || created.dbId;
  writeEnv(token, cleanDbId);
  console.log(ok(`已寫入 ${ENV_PATH}`));

  // Remove stale disabled marker
  if (existsSync(DISABLED_PATH)) {
    unlinkSync(DISABLED_PATH);
    console.log(info('已自動移除 .env.disabled 標記檔'));
  }

  // Full verification pass
  console.log('\n執行完整驗證...');
  const full = await verify({ token, dbId: cleanDbId });
  printVerifyResult(full);

  return full.ok;
}

// ============================================================
// Mode C — Disable on this device
// ============================================================
async function modeC() {
  console.log(`\n${c.bold}Mode C — 停用這台電腦的 handover${c.reset}`);
  console.log('這會做下面這些事：');
  console.log('  • 建立 .env.disabled 標記檔');
  console.log('  • 之後在這台機器呼叫 /handover 會乾淨回「已停用」，不會報錯');
  console.log('  • 若有 .env 會保留（只是被忽略），之後想啟用不用重輸');
  console.log('  • 要重新啟用：刪 .env.disabled，或重跑這個 wizard');

  const confirm = await askYN('\n確定停用？', false);
  if (!confirm) return false;

  const content = `DISABLED=true\nDISABLED_AT=${new Date().toISOString()}\nDISABLED_DEVICE=${hostname()}\n`;
  writeFileSync(DISABLED_PATH, content);
  console.log(ok(`已停用，標記檔寫入：${DISABLED_PATH}`));
  return true;
}

// ============================================================
// Mode 4 — Verify current setup
// ============================================================
async function modeVerify() {
  const env = loadEnvFile(ENV_PATH);
  const token = env.NOTION_HANDOVER_TOKEN;
  const dbId = env.NOTION_HANDOVER_DB_ID;
  if (!token || !dbId) {
    console.log(fail('目前沒有設定（找不到 .env 或欄位缺失）。'));
    return false;
  }
  console.log('\n驗證 .env 中的設定...');
  const result = await verify({ token, dbId });
  printVerifyResult(result);
  return result.ok;
}

// ============================================================
// Main menu
// ============================================================
async function main() {
  console.log(`\n${c.bold}${c.cyan}Claude Handover 設定精靈${c.reset}`);
  console.log(c.dim + '─'.repeat(50) + c.reset);

  const { status } = snapshotStatus();
  console.log(`這台電腦 : ${hostname()}`);
  console.log(`目前狀態 : ${status}`);
  console.log(`設定路徑 : ${c.dim}${SKILL_DIR}${c.reset}`);

  console.log('\n你想做什麼？');
  console.log('  1) 連到現有的 Notion DB（我有 token 和 DB ID）');
  console.log('  2) 從零建立新的 Notion DB（帶我走流程）');
  console.log('  3) 停用這台電腦的 handover');
  console.log('  4) 驗證目前的設定');
  console.log('  5) 離開');

  const choice = (await ask('\n選擇 [1-5]: ')).trim();

  let success = false;
  switch (choice) {
    case '1': success = await modeA(); break;
    case '2': success = await modeB(); break;
    case '3': success = await modeC(); break;
    case '4': success = await modeVerify(); break;
    case '5': case 'q': case 'exit': console.log('bye!'); break;
    default: console.log(fail(`未知選項: ${choice}`));
  }

  rl.close();

  if (choice >= '1' && choice <= '4') {
    console.log('\n' + (success ? c.green + '完成。' : c.yellow + '未完成或已取消。') + c.reset);
  }
  process.exit(success || choice === '5' ? 0 : 1);
}

main().catch((e) => {
  console.error(fail(`Wizard crashed: ${e.message}`));
  console.error(e.stack);
  rl.close();
  process.exit(1);
});
