# 新 Agent 工作目錄選擇器(Workspace Picker)設計

**日期**:2026-07-21
**狀態**:設計已核准(流程 + 後端 + 元件三段皆過),待寫實作計畫

## 目標

開新 Agent(控制模式)時,在 UI 用一個**目錄選擇器**挑選(或當場建立)一個資料夾當該次 agent 的
工作目錄(cwd),而不是像現在只能靠啟動 server 時的 `AGENT_WORKSPACE` 環境變數固定。

## 為什麼是「後端目錄瀏覽」而非瀏覽器原生選擇器

agent 在**後端**用 SDK 啟動,cwd 必須是真實作業系統路徑。瀏覽器基於安全**不會**把真實路徑交給網頁:
`showDirectoryPicker()` 只給沙箱 handle + 資料夾名、`<input webkitdirectory>` 只給相對路徑。因此路徑必須
從**後端**產生 —— 後端列目錄、前端導覽選取。(評估時已排除原生對話框與貼路徑兩案,選定此案。)

## 使用者決策(已確認)

| 項目 | 決定 |
|---|---|
| 觸發點 | 點「＋新 Agent」→ 彈出工作目錄選擇器(而非立即進空白控制模式) |
| 預設位置 | 選擇器停在目前工作目錄;直接確認 = 維持現狀 |
| 建立專案 | 在瀏覽中的目錄下 `mkdir` 一個**空資料夾**當 cwd(不 scaffold、不 git init) |
| 最近目錄 | v1 不做(YAGNI) |
| 模式範圍 | 只影響控制模式;觀察模式完全不碰 |

## 使用者流程

1. 來源下拉點「＋新 Agent」→ 開 `WorkspacePicker` 彈窗。
2. 彈窗:頂部**麵包屑**顯示目前路徑;清單列**子資料夾**(可點進去)、`..`(回上層);在磁碟根時列
   磁碟機(`C:\ D:\…`)。
3. 底部一列「新資料夾名稱 `[____]` ＋建立」→ 在目前瀏覽的目錄下建資料夾並選中(進入該資料夾)。
4. 「使用這個目錄」→ 關窗、進入控制模式、以該路徑為 cwd,header 立即顯示。
5. 預設停在目前工作目錄,想維持現狀直接按確認。

## 架構:後端無狀態目錄 API + cwd 穿線

### 後端

**`src/dirs.ts`(新建,純函式為主)**
- `listDirs(path: string): { path: string; parent: string | null; drives?: string[]; entries: string[] }`
  - `path` 為空字串 → 回磁碟根視圖:Windows 掃 `A:`–`Z:` 存在者放進 `drives`(`entries` 空、`parent=null`);
    POSIX 則解析成 `/` 並照常列 `/` 底下的子資料夾(無 `drives`)。
  - `entries` 只列**子資料夾名**(忽略檔案);讀不到權限的子項略過,不讓整支拋錯。
  - `parent`:`path` 的上一層;已在磁碟根(如 `C:\`)時為 `null`(前端顯示磁碟機清單)。
  - `path` 不存在或不是目錄 → 拋 `Error`(路由轉 400)。
- `makeDir(parent: string, name: string): string`
  - 防呆:`name` 非空、不含路徑分隔符(`/` `\`)、非 `.`/`..`;`parent` 存在且是目錄。
  - 建立資料夾,回新路徑;已存在 / 權限 / 非法 → 拋 `Error`(路由轉 400/500)。

**`src/server.ts`(新增路由)**
- `GET /dirs?path=<絕對路徑>` → `res.json(listDirs(path))`;`path` 省略 = 空字串(磁碟根)。錯誤回 400。
- `POST /mkdir { parent, name }` → `res.json({ path: makeDir(parent, name) })`;錯誤回 400。
- 兩支都 try/catch、印實際 error(遵全域偏好,不默默吞錯)。

**cwd 穿線**(把目前寫死的 cwd 改成可帶參數,env 當預設):
- `src/agentAdapter.ts`:`buildOptions(canUseTool, abortController, cwd?)` → `cwd: cwd ?? resolveWorkspace()`;
  `realRunQuery({ prompt, canUseTool, signal, cwd? })` 把 cwd 傳進 buildOptions。
- `src/sessionManager.ts`:`start(initialPrompt, cwd?)` → `runQuery({ …, cwd })`。`RunQuery` 型別加 `cwd?`。
- `src/sourceController.ts`:`toControl(cwd?)` → `workspace = cwd ?? this.controlWorkspace()`,並存 `controlCwd`;
  新增 getter `controlCwd(): string | undefined`。
- `src/server.ts`:
  - `POST /new-agent { cwd? }` → `controller.toControl(cwd)`。
  - `POST /start { prompt }` → `mgr.start(prompt, controller.controlCwd())`(從觀察切回時仍先 toControl)。

`resolveWorkspace()` / `AGENT_WORKSPACE` 從「唯一來源」降為「預設值」,不衝突。header 的 workspace 走
snapshot,選完立即反映。

### 前端

**`web/src/components/WorkspacePicker.tsx`(新建)**
- 彈窗:麵包屑(目前 path)、子目錄清單(點進)、`..`(回 parent;為 null 時顯示磁碟機清單)、
  「新資料夾名稱 + 建立」列、「使用這個目錄」/「取消」。
- props:`initialPath`、`loadDirs(path) => Promise<DirListing>`、`makeDir(parent,name) => Promise<string>`、
  `onConfirm(path)`、`onClose`。內部 state:目前 listing、建資料夾錯誤訊息。

**`web/src/useSession.ts`**
- `newAgent(cwd?: string)` → `POST /new-agent { cwd }`(目前是 `{}`)。
- 新增 `loadDirs(path: string): Promise<DirListing>`、`makeDir(parent, name): Promise<string>`(失敗回帶錯誤,
  不拋)。

**`web/src/components/SourcePicker.tsx`**
- 「＋新 Agent」onClick 改成**開 `WorkspacePicker`**(不再直接 `onNewAgent()`);選擇器確認 → `newAgent(cwd)`。
- 需要目前 workspace 當 `initialPath` → 由 `App` 把 `state.workspace` 傳入。

**`web/src/wireTypes.ts`**
- `interface DirListing { path: string; parent: string | null; drives?: string[]; entries: string[] }`。

## 資料型別

```ts
// 後端 src/dirs.ts 與前端 wireTypes.ts 對應
interface DirListing {
  path: string            // 目前解析後的絕對路徑('' 代表磁碟根視圖)
  parent: string | null   // 上一層;磁碟根時為 null
  drives?: string[]       // 磁碟根視圖時的磁碟機(Windows)
  entries: string[]       // 子資料夾名(不含檔案)
}
```

## 錯誤處理

- **後端**:`/dirs` path 不存在/非目錄 → 400;`/mkdir` 名稱非法/已存在/權限 → 400;一律印實際 error。
- **前端**:`loadDirs` 失敗 → 彈窗顯示「無法讀取此目錄」並留在原地;`makeDir` 失敗 → 建資料夾列下方紅字。
- 權限讀不到的子資料夾:`listDirs` 靜默略過該項(不整支失敗)。

## 測試

- **後端(vitest, node)**:
  - `listDirs`:合成暫存目錄 → 只回子資料夾(忽略檔案)、`parent` 正確、path 不存在拋錯。
  - `makeDir`:建立成功回新路徑;`name` 含分隔符 / `..` / 已存在 → 拋錯。
  - cwd 穿線:`buildOptions(fn, ac, 'C:/x').cwd === 'C:/x'`;無 cwd 時 = `resolveWorkspace()`;
    `SessionManager.start(prompt, cwd)` → 注入的假 runQuery 收到 `cwd`。
  - `SourceController.toControl(cwd)` → `workspace === cwd` 且 `controlCwd() === cwd`。
- **前端(vitest + jsdom)**:
  - `WorkspacePicker`:載入 listing 顯示子目錄;點子目錄 → 以新 path 再 loadDirs;`..` → 回 parent;
    建資料夾 → 呼叫 makeDir 並進入新目錄;「使用這個目錄」→ `onConfirm(目前 path)`。
  - `App`/`SourcePicker`:點「新 Agent」→ 開選擇器 → 確認 → `POST /new-agent { cwd }`(假 fetch 驗 body)。

## 不做(YAGNI)

- 最近使用目錄清單、我的最愛。
- scaffold / git init / 範本(只 mkdir 空資料夾)。
- 觀察模式改目錄(觀察是唯讀歷史,無此概念)。
- header 隨時改目錄的獨立按鈕(這次只做 New Agent 觸發;日後要再加)。
- 路徑沙箱限制(localhost 單人工具,agent 本就在某 cwd 跑受核准的工具,選 cwd 未擴大信任邊界)。
