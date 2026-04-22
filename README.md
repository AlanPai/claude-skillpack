# claude-skillpack

Public skill pack for [Claude Code](https://docs.claude.com/en/docs/claude-code). Drop-in skills you can add to your own `~/.claude/` — or clone this repo as the basis for your `.claude` directory.

## 內容

| Skill | 做什麼 |
|---|---|
| **handover** | 把 session 結束時的工作狀態寫成結構化交班單，存到 Notion 資料庫。跨裝置、跨 AI 都能接手。含 `setup.mjs` 互動精靈、`verify.mjs` 驗證器。 |
| **resume** | 從 Notion 讀回之前的交班單，把 context 注入當前對話。`/resume`、`/resume 5`、`/resume --project=foo`。 |
| **list** | 列出所有交班紀錄，支援模糊搜尋專案名稱。`/list`、`/list --search=gmail`。 |

## 怎麼用

### 方法 A：透過 [claude-setup 網頁工具](https://claude-setup-nu.vercel.app) 一鍵安裝

推薦新手走這條路。網頁問你幾個問題（有沒有 GitHub 帳號、本地有沒有 .claude 等），產出對應的安裝指令。

選「🎁 裝現成的 Claude 設定包」→ skill pack URL 填 `https://github.com/AlanPai/claude-skillpack.git`。

### 方法 B：手動 clone 合併到你現有的 .claude

```bash
# 複製整個 skills/ 資料夾進你的 ~/.claude/skills/
git clone https://github.com/AlanPai/claude-skillpack.git /tmp/skillpack
cp -r /tmp/skillpack/skills/* ~/.claude/skills/
rm -rf /tmp/skillpack
```

### 方法 C：直接拿這個 repo 當你的 .claude

```bash
# 適合完全新環境
git clone https://github.com/AlanPai/claude-skillpack.git ~/.claude
cd ~/.claude
# 換成你自己的 remote（之後 push 到你私人的 repo）
git remote remove origin
git remote add upstream https://github.com/AlanPai/claude-skillpack.git
git remote add origin <你自己的 repo URL>
```

## Handover skill 怎麼啟用

handover / resume / list 需要 Notion 憑證才能運作。三選一：

1. **跑設定精靈（推薦）**：`node ~/.claude/skills/handover/scripts/setup.mjs`
   - Mode A：已有 Notion DB，貼 token + DB ID 驗證
   - Mode B：從零開始，精靈帶你建 integration + DB
   - Mode C：不想用 handover，寫停用標記檔

2. **手動建 `.env`**：
   ```
   ~/.claude/skills/handover/.env
   ─────────────
   NOTION_HANDOVER_TOKEN=ntn_xxxxx
   NOTION_HANDOVER_DB_ID=32字元hex
   ```

3. **設環境變數**：`NOTION_HANDOVER_TOKEN` + `NOTION_HANDOVER_DB_ID`

## 不含什麼

這個 repo **只有 skills/**，不是完整的 `~/.claude/`。不含：

- 個人 `CLAUDE.md` memory（每個人的 memory 自己寫）
- 個人 `settings.json`（Claude Code 預設值夠用）
- 個人 `commands/`、`hooks/`、`agents/`
- 其他個人化設定

你可以把這個 repo 當作**最小可用骨架**，往上加自己的東西。

## Roadmap / 已知議題

- [ ] Mode B 完全互動流程在真新裝置實測
- [ ] setup.mjs 加 non-interactive CLI flags
- [ ] /push-skill 快捷指令

## License

MIT — 自由 fork、改、用。
