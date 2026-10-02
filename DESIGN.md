# 记电（预付费电表余额台账）系统设计方案 v2（定稿）

- **文档位置**：`D:\web\1551114.xyz\dianji\DESIGN.md`
- **目标访问地址**：`https://1551114.xyz/dianji/`
- **代码仓库**：`https://github.com/Happy-soy-sauce/Happy-soy-sauce.github.io`（main 分支）
- **操作范围**：仅 `D:\web`（工作区即此目录）
- **硬约束**：① 不自建需运维的服务器；② **不修改 `D:\web\1551114.xyz` 下任何既有文件**（只新增 `dianji/` 目录）；③ 前端复用站点根样式 `css/style.css`；④ **不做 DNS 迁移**。

---

## 0. 已定稿决策（本轮确认）

| 编号 | 决策 | 说明 |
|---|---|---|
| D1 | 数据单位 = **度（kWh）**，电价 **1 度 = 0.5 元** | 你给的历史数据是度；电价作为账本级配置，用于折算金额 |
| D2 | 不加首页入口链接 | 不修改既有 `index.html` |
| D3 | **不做 DNS 迁移** | 担心春节等时段域名被污染；因此 Cloudflare Worker 绑定自定义域方案作废 |
| D4 | 存储 = **路线 A：纯前端 + GitHub 私有数据仓库 + fine-grained PAT** | 唯一同时满足「不自建服务器」「不迁 DNS」「浏览器单页上传」「GitHub 托管账本」的方案 |
| D5 | 预注册账号 **5 个**，需要「谁录的」统计 | 记录内 `by` 字段 + 按人汇总 |
| D6 | 账单图片上传 | **暂缓**，列为 P5 可选项（见 §9.4） |
| D7 | `api.github.com` 实测可达 | 本机出口 IP `58.152.58.122`：`http=403`（未认证限速），非网络不通；认证后 5000 次/小时 |
| D8 | 登录 = 共享 token 切片成 5 份密码 + 本地 SHA-256 预鉴权 | 因 `github.com` 国内困难，设备码登录与「每人一个 token」均不可行 |

---

## 1. 实地勘察结论（本方案的事实基础，均为实测）

| 对象 | 实测结果 |
|---|---|
| `D:\web\1551114.xyz` | git 仓库，`origin = https://github.com/Happy-soy-sauce/Happy-soy-sauce.github.io.git`，分支 `main` |
| 部署链路 | push `main` → `.github/workflows/static.yml` → `upload-pages-artifact`（`path: '.'`，**整仓库上传**）→ `deploy-pages` |
| 自定义域 | `1551114.xyz` 由 DNS 解析到上述 GitHub Pages 站点 |
| 根样式 | `css/style.css`（1401 行），提供 `.container` `.card` `.card-title` `.about-text` `.neu-btn(.primary)` `.link-grid` `.download-row` `.cards-grid` `.back-link` `.stat-grid` `.stat-card` `.stat-item` `.stat-label-sm` `.stat-value-sm` `.site-header` `.site-title` `.site-footer` `.error-card`；变量 `--primary --bg --text --text-light --radius --glass-bg --glass-border --glass-blur --shadow-light --shadow-dark` |
| 子项目既有模式 | `mcmod/`、`clashAAdd/` 均为 `<link rel="stylesheet" href="../css/style.css">` + 可选 `css/<name>.css` |
| 约定证据 | `clashAAdd/css/clashadd.css` 首行注释：“站点 1551114.xyz/css/style.css 提供基础组件（container/card/card-title/about-text/link-grid/neu-btn 等），本文件补充…专属样式” |
| 网络实测 | `api.github.com` → `http=403`（`API rate limit exceeded for 58.152.58.122`，未认证共享限速，**链路通**） |
| 数据仓库实勘 | `happysoysaucemin/dateofhappy`：存在、初为**公开空仓库**（`git ls-remote` 退出码 0 无 refs）；`api.github.com` 国内直连正常，`github.com` 网页请求超时 |
| **本地未提交改动（不得触碰）** | `M index.html`（你 2026-08-20 的改动）；未跟踪 `.vs/`、`backup/`、`clashAAdd/` |
| 本次唯一新增 | `dianji/`（未跟踪，未 add、未 commit、未 push） |

**结论：记电作为主站子目录 `dianji/` 落地，完全套用 `mcmod/` 模式**，随主站构建自动部署，零既有文件改动。

---

## 2. 需求定义

| 编号 | 需求 | 来源 |
|---|---|---|
| R1 | 记录预付费电表余额流水：日期、抄表余额（度）、充值（度） | 你的样例数据 |
| R2 | 自动算每期消耗、日均消耗、余额耗尽预测，并折算成元 | 「记电」的价值所在 |
| R3 | 5 人共享同一个账本，能看「谁录的」 | D5 |
| R4 | 账号限定预注册，当前一本账本，后续可扩容 | 你的答复 |
| R5 | **仅靠浏览器一个页面就能上传账单**，不装工具、不跑命令 | 你的答复 |
| R6 | 账本数据交由 GitHub 托管（有完整历史） | 你的答复 |
| R7 | 页面托管 GitHub Pages、解析到 `1551114.xyz`、不复用 DNS 迁移 | 本轮约束 |
| R8 | 复用站点根 CSS，不改动既有文件 | 本轮约束 |

---

## 3. 数据模型

### 3.1 单位与口径（v2 关键修正）

- **存储与展示主单位 = 度（kWh）**：`balance`、`topup`、`consumed` 全部是度。
- **电价 = 0.5 元/度**，作为账本级配置项 `unit_price_cny`，仅用于**折算金额**，不参与消耗计算。
- 折算只在前端做：`元 = 度 × 0.5`，避免单位混进数据文件。

### 3.2 记录字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✔ | = `recorded_at`，天然唯一，用于幂等去重 |
| `recorded_at` | string | ✔ | 抄表时刻，ISO 8601 带时区，如 `2026-09-23T07:00+08:00` |
| `slot` | `am` \| `pm` | ✔ | 早/晚抄表，与日期共同构成唯一键 |
| `balance` | number | ✔ | 抄表时表上显示的**剩余电量（度）** |
| `topup` | number | ✔（默认 0） | 本次充值**电量（度）** |
| `by` | string | ✔ | 录入人（5 个预置名字之一）→ 满足 D5 |
| `note` | string | ✗ | 备注（如「充值 100 度」「换表」） |

### 3.3 计算规则（唯一口径）

```
有效余额 effective = balance + topup            （单位：度）
本期消耗 consumed = 上一条(按 recorded_at 升序)的 effective - 本条 balance
折合金额 cny      = 度 × unit_price_cny(0.5)
```

**用你给的真实数据校验（全部吻合，单位：度）：**

| recorded_at | balance | topup | effective | consumed | 折合 |
|---|---|---|---|---|---|
| 2026-09-23 早 | 6.9 | 100 | **106.9** | — | — |
| 2026-09-24 早 | 102.3 | 0 | 102.3 | **4.6** | 2.30 元 |
| 2026-09-25 早 | 87.8 | 0 | 87.8 | **14.5** | 7.25 元 |
| 2026-09-26 早 | 72.5 | 0 | 72.5 | **15.3** | 7.65 元 |
| 2026-09-27 早 | 56.8 | 0 | 56.8 | **15.7** | 7.85 元 |
| 2026-09-28 早 | 43.0 | 0 | 43.0 | **13.8** | 6.90 元 |

聚合量：
- 观测期（9.24→9.28，5 个间隔）总消耗 **63.9 度** = 31.95 元，日均 **12.78 度/天 = 6.39 元/天**
- 月化估算：约 **383 度 ≈ 191.7 元/月**
- 当前余额 43.0 度（21.5 元）→ **预计还能用 3.4 天，约 10 月 1 日晚间耗尽**

### 3.4 账本配置与存储文件

单文件 `readings.json`，一年约 730 条 ≈ 80 KB：

```json
{
  "version": 1,
  "ledger": "家用电表",
  "unit": "kWh",
  "unit_price_cny": 0.5,
  "updated_at": "2026-10-02T16:40:00+08:00",
  "readings": [
    { "id": "2026-09-23T07:00", "recorded_at": "2026-09-23T07:00+08:00", "slot": "am",
      "balance": 6.9, "topup": 100, "by": "爸爸", "note": "充值100度" },
    { "id": "2026-09-24T07:00", "recorded_at": "2026-09-24T07:00+08:00", "slot": "am",
      "balance": 102.3, "topup": 0, "by": "爸爸", "note": "" }
  ]
}
```

- `consumed` / `effective` **不落盘**，纯派生值，永远实时计算，杜绝数据自相矛盾。
- 以 `recorded_at` 为 `id`：重复粘贴同一天同时段数据 = 幂等覆盖，不产生脏数据。

---

## 4. 存储方案：定稿路线 A

```
浏览器页面  https://1551114.xyz/dianji/   （GitHub Pages，复用 ../css/style.css）
      │  登录后从会话取凭据（本地 SHA-256 预鉴权，不落 localStorage）
      │  HTTPS
      ▼
GitHub Contents API  https://api.github.com   ← 实测可达（D7）
      ▼
私有仓库  happysoysaucemin/dateofhappy / readings.json
      └ git 提交历史 = 账本变更历史（可 diff / 回滚 / 审计）
```

**为什么是它：**

| 要求 | 路线 A 的满足方式 |
|---|---|
| 不自建服务器 | 无后端，纯静态页面 + GitHub REST API |
| 不迁 DNS | 完全不碰 DNS，`dianji/` 走既有 GitHub Pages 域名 |
| 浏览器单页上传 | 页面内「粘贴账单 → 预览 → 上传」，无需任何本地工具 ✔ R5 |
| GitHub 托管账本 | 真相源就是仓库里的 `readings.json` ✔ R6 |
| 5 人共享 + 谁录的 | 共享 PAT + 页面内 `by` 选择 → 满足 D5 ✔ |
| 成本 | 0 元 |

**已知代价（如实列出）：**

1. **凭据仍存在于浏览器端**。P3 已把 token 从 `localStorage` 移出（改为登录后仅存内存／会话级 `sessionStorage`，并先做本地摘要预鉴权），但共享 token 的固有边界仍在：任何一份登录密码被完整看到即等于 token 泄露，且无法单独撤销某个成员。详见 §8.6。
2. **依赖 `api.github.com` 的国内可达性**。本机实测通（D7），但**手机端需自行实测**。缓解：`store.js` 里把 API base URL 做成可配置项（默认 `https://api.github.com`），万一某网络环境不通，将来换任何可用出口只改一个配置，不用重写。
3. 未认证请求会被共享 IP 限速（实测 403 即此原因）；**认证后 5000 次/小时**，你每天写几条，余量极大。

**为什么放弃了 Cloudflare Worker 方案（原路线 B）：** 它必须把 Workers 绑定到自定义域才能有好的国内可达性，而那要求 `1551114.xyz` 的 NS 迁到 Cloudflare —— 直接违反 D3。`*.workers.dev` 域名国内经常不可达，不值得为此引入一个账号。

---

## 5. 系统结构（文件级）

严格对齐 `mcmod/`、`clashAAdd/` 既有模式：

```
D:\web\1551114.xyz\           ← 主站仓库（不改任何既有文件）
├── css\style.css             ← 站点根样式（只读引用）
├── index.html                ← 不改（D2）
├── mcmod\   clashAAdd\       ← 既有子项目，不动
└── dianji\                   ← 【唯一新增】
    ├── DESIGN.md             ← 本文档
    ├── index.html            ← 单页应用：登录 / 录入 / 批量粘贴 / 流水 / 统计 / 导出
    ├── package.json          ← 提供 npm test（项目自测入口）
    ├── css\dianji.css        ← 只补根样式没有的部分（表单、流水表、图表容器、告警色）
    ├── js\
    │   ├── config.js         ← API base、预置名单、电价、仓库名
    │   ├── sha256.js         ← 纯 JS SHA-256（零依赖，file:// 也可用）
    │   ├── calc.js           ← consumed / effective / 日均 / 耗尽预测 / 度↔元（唯一口径）
    │   ├── parse.js          ← 粘贴文本解析器（§7）
    │   ├── chart.js          ← 手写 SVG 柱状图 + 折线图（零依赖）
    │   ├── store.js          ← GitHub Contents API 读写、幂等合并、409 重试、导出
    │   ├── auth.js           ← 本地预鉴权、密码切片还原、会话级凭据
    │   ├── auth-table.js     ← 5 份密码的 SHA-256 摘要（由工具生成）
    │   └── ui.js             ← DOM 渲染与事件绑定
    └── tools\
        ├── make-passwords.js ← 生成 5 份登录密码并回写摘要表
        ├── selftest.js       ← 离线自测（npm test，38 项断言）
        └── netcheck.js       ← 真实网络只读自检（npm run netcheck）
```

`index.html` 的 head 两行样式引用，与既有子项目完全一致：

```html
<link rel="stylesheet" href="../css/style.css">   <!-- 站点根 CSS -->
<link rel="stylesheet" href="css/dianji.css">    <!-- 本页补充样式 -->
```

---

## 6. 页面与交互设计（复用根 CSS）

| 区块 | 复用根 CSS | 说明 |
|---|---|---|
| 顶部 | `.container` `.site-header` `.site-title` `.back-link` | 与 mcmod 一致 |
| 统计卡 | `.stat-grid` `.stat-card` `.stat-item` `.stat-label-sm` `.stat-value-sm` | 当前余额（度/元）、近 7 日均耗、预计可用天数、本月充值；**< 3 天量时标红告警** |
| 录入卡 | `.card` `.card-title` `.neu-btn.primary` + 本页表单 | 日期（默认今天）、早/晚、**余额（度）**、**充值（度，默认 0）**、录入人（5 人下拉）、备注 |
| 批量粘贴 | `.card` `.card-title` + 本页 `<textarea>` | §7，一次导入多行 |
| 流水与图表 | `.card` `.card-title` `.link-grid` | 近 30 天消耗柱状图 + 余额曲线 + 按月分组流水表（可编辑/删除） |
| 底部 | `.site-footer` | 与站点一致 |

关键交互：
1. **实时差值提示**：输入余额时立即显示「上一条 102.3 度 → 本次 **−14.5 度（−7.25 元）**」，抄错立刻可见。
2. **幂等保存**：同 `recorded_at` 重复提交 = 覆盖更新。
3. **移动端优先**：`<input type="number" inputmode="decimal">` 唤起数字键盘，单手可操作。
4. **导出**：CSV / JSON / Markdown 月报三个按钮，纯前端 `Blob` 下载 —— 免费方案下最后的兜底。
5. **乐观并发**：写入带本次读到的 `sha`，遇 409 冲突则重拉合并重试（最多 3 次），防止两人同时上传相互覆盖。
6. **离线草稿**：写入失败时把草稿存 localStorage 并明确提示，不丢数据。

---

## 7. 批量粘贴解析规则（R5 关键）

你的数据就是从别处复制出来的文本，所以「粘贴即导入」是第一功能。支持空格/Tab 分隔：

```
9.23早    6.9    100    106.9
2026-09-24 早  102.3
09-25 pm  87.8
2026-09-27    56.8
```

解析规则：

```
^(?<date>(\d{4}[-/.])?\d{1,2}[-/.]\d{1,2})\s*
 (?<slot>早|晚|am|pm|AM|PM)?\s+
 (?<balance>\d+(?:\.\d+)?)\s*
 (?<topup>\d+(?:\.\d+)?)?
```

- 缺年份 → 补当前年份；缺时段 → 默认 `am`。
- 第 3 个数按「充值」处理；行尾多余的数（如 `106.9`）识别为**该行的有效余额校验值**，若与 `balance+topup` 不符则在预览中标黄提示。
- 解析结果先进**预览表**，可逐行修正/勾选跳过，确认后才写入。
- **验收用例**（本项目的验收准则）：

  ```
  9.23早	6.9	 100	106.9	 9.24早	102.3	4.6 9.25早	87.8	14.5 9.26早	72.5	15.3 9.27早	56.8	15.7 9.28早	43.0 	 13.8
  ```

  期望：解析出 6 行；`effective` = 106.9 / 102.3 / 87.8 / 72.5 / 56.8 / 43.0；`consumed` = `—, 4.6, 14.5, 15.3, 15.7, 13.8`。

---

## 8. 登录与鉴权（v3 定稿）

### 8.1 约束直接决定了形态

| 约束 | 后果 |
|---|---|
| `github.com` 国内访问困难 | 设备码登录（需访问 `github.com/login/device`）不可用 |
| 同上 | 家人无法自行生成 token，也就做不了「每人一个 GitHub 账号」 |
| 页面托管在公开的 GitHub Pages 上 | HTML 里**绝不能出现明文 token**，只能放摘要 |
| 不想每次手输凭据 | 需借助浏览器密码管理器或会话级保持 |

**结论：全账本共享一个最小权限 token，按成员切片成 5 份「登录密码」分发。** 这是上述约束下唯一可行的形态。

### 8.2 密码构造

```
登录密码 = token 前 head 位（默认 8） + 成员标识码（idLen 位，默认 4） + token 其余部分
```

- `head` / `idLen` 必须与 `js/auth.js` 的 `conf.head` / `conf.idLen` 一致。
- 生成：`node tools/make-passwords.js <TOKEN> 成员一:0001 成员二:0002 … --write`
- 5 份密码互不相同：便于浏览器按不同用户名分别记住，也便于本地识别身份。

### 8.3 客户端流程（「预鉴权」）

1. 输入密码 → 本地算 SHA-256 → 与 `js/auth-table.js` 的摘要比对。
2. **不命中 → 立即拒绝，不发起任何网络请求**（避免错误凭据打到 GitHub）。
3. 命中 → 识别身份（`by`）+ 还原完整 token（跳过标识码）→ 仅存内存 / 会话级 `sessionStorage`。
4. 真正的鉴权始终由 GitHub 完成：token 被撤销或权限不足时 API 返回 401 / 403。

### 8.4 为什么放摘要而不是明文

token 是高熵长串，SHA-256 无法被反查，所以把摘要放在公开页面上是安全的；明文一旦写进 HTML 就等于公开泄露。

`js/sha256.js` 用纯 JS 实现而不用 `crypto.subtle`，是为了 `file://` 本地打开时预鉴权依然可用。

### 8.5 token 的最小权限要求（重要）

- Repository access：**只勾 `happysoysaucemin/dateofhappy` 一个仓库**
- Permissions：只给 **Contents: Read and write**
- 有效期：90 天，到期轮换

这样即使某份密码被完整看到，影响面也仅此一个账本，且可用 git 历史回滚。

### 8.5b 为什么不用 SSH 密钥（浏览器端做不到）

1. 浏览器没有原始 TCP socket API，而 SSH 跑在 TCP 上 —— 网页 JS 无法建立这种连接，这是浏览器安全模型决定的，不是缺库。唯一绕过办法是放一个 WebSocket→SSH 网关，那需要一台服务器。
2. GitHub 的 REST API 只认 token，不认 SSH 密钥。
3. SSH 反而更不安全：`git push` 需要私钥，而私钥默认对账号下**所有**仓库有效；唯一粒度接近的 Deploy Key 同样必须把私钥放进浏览器，且所有提交都是同一个 key 身份，会丢掉「谁录的」。

**结论**：在「纯浏览器 + 无服务器」的架构下，token 是唯一可用的凭据形态，fine-grained PAT 已经是其中权限最小的。

### 8.6 如实说明的两个边界

1. 5 份密码每一份都含完整 token（只差 4 位标识码），**任何一份被完整看到 = token 泄露**。它挡得住「瞥一眼屏幕」，挡不住「知道格式的人」。
2. 共享 token 意味着**无法单独撤销某个成员**，也无法真正防冒名。要同时做到这两点，必须每人一份独立凭据 —— 而那需要 `github.com` 可达。

### 8.7 轮换与应急

- 轮换：GitHub 重新签发 token → 重跑 `make-passwords.js … --write` → 提交推送 → 通知 5 人重新登录。
- 应急：直接在 GitHub 撤销该 token，所有人立即失效。

### 8.8 凭据存放位置

| 位置 | 存什么 |
|---|---|
| `localStorage` | 只存账本数据与偏好（仓库名、上次身份）；代码与自测均保证**绝无凭据写入**，并会就地清除旧版本遗留的明文 |
| `sessionStorage` | 登录后的 token 与身份（关闭浏览器即失效；可改为纯内存） |
| `js/auth-table.js` | 5 份密码的 SHA-256 摘要（公开可安全） |

## 9. 统计与可靠性

### 9.1 统计指标

| 指标 | 定义 |
|---|---|
| 当前余额 | 最后一条的 `effective`（度 / 元） |
| 近 7 日 / 近 30 日日均 | `sum(consumed) / 天数`（度/天、元/天） |
| 预计可用天数 | `当前余额 / 近 7 日日均` |
| 预计耗尽日期 | `今天 + 预计可用天数` |
| 本月充值 | 当月 `sum(topup)`（度 / 元） |
| 个人统计 | 按 `by` 汇总录入条数（D5） |
| 图表 | 近 30 天消耗柱状图 + 余额折线（手写 SVG，零依赖） |

### 9.2 安全清单

- [ ] 凭据绝不写入仓库、绝不进代码；登录密码只经本地 SHA-256 预鉴权，token 仅存内存／会话级 `sessionStorage`
- [ ] `happysoysaucemin/dateofhappy` 必须**私有**，且不需要开启 Pages
- [ ] 前端零第三方脚本/CDN（图表手写 SVG），规避供应链风险与 CDN 不可达
- [ ] 全链路 HTTPS（GitHub Pages 默认强制）
- [ ] 409 冲突自动合并重试；失败保留草稿并明确提示
- [ ] 每周/每月手动导出一份 JSON 到本地或网盘（免费方案的最后兜底）

### 9.3 手机端可达性自检

上线后请在**手机浏览器**（不要挂代理）打开 `https://api.github.com/`，能返回一段 JSON 就说明路线 A 在你的日常网络下可用。若不通，改 `js/config.js` 里的 API base 指向任何可用出口即可，其余代码不用动。

### 9.4 账单图片上传（D6：暂缓）

将来若要，**零新增服务**的做法：图片压缩到 ≤ 300 KB 后提交到 `happysoysaucemin/dateofhappy` 仓库的 `images/` 目录，记录里存相对路径。仓库软上限 1 GB，够存数万张。缺点是仓库变大会拖慢 clone、且图片读取走 `raw.githubusercontent.com`，国内可达性一般。因此**列为 P5 可选项，本轮不做**。

---

## 10. 部署步骤（不破坏现有主站）

### 10.1 准备数据仓库（`happysoysaucemin/dateofhappy`）

该仓库已存在，目前是**公开**且**空**的（无任何提交）。按顺序处理：

1. **改为私有**：仓库 Settings → General → 拉到底部 Danger Zone → Change repository visibility → Make private。
   公开仓库的读取无需任何凭据，用电数据会被人和爬虫读到，务必先改。
2. **先造一个初始提交**：空仓库没有任何分支，Contents API 无法直接写入首个文件。
   在仓库网页上点「Add a README」，或直接把页面「导出 JSON」得到的文件上传成 `readings.json`。
3. **生成 fine-grained PAT**：Repository access 勾选 `dateofhappy`；Permissions 只给 `Contents: Read and write`；有效期 90 天。
4. **常见坑（务必看）**：fine-grained token 的 Repository access 必须**显式勾选该仓库**。若 token 是在仓库创建之前签发的，选「Only select repositories」时根本勾不到它 —— 之后所有读写都会返回 `403 Resource not accessible by personal access token`，而这个报错完全看不出原因。该账号下只有一个仓库，推荐直接选「All repositories」，一劳永逸。
5. 页面「数据仓库设置」里确认仓库名为 `happysoysaucemin/dateofhappy`，然后点「**检查连接**」做一次只读自检。它会把 401 / 403 / 404 翻译成能照着做的提示，并顺带提醒仓库是否仍为公开。
6. **命令行验证（可选）**：`GH_TOKEN=<记电token> npm run netcheck` —— 只读自检，会打印仓库可见性、读回的记录条数与消耗序列，不产生任何提交。

### 10.2 上线前端（零风险，唯一改动是新增目录）

1. 新增并填充 `D:\web\1551114.xyz\dianji\`（本文档已在其中）。
2. 本地预览：直接双击 `dianji\index.html`，或 `python -m http.server 8000`。
3. 推送时**只 add `dianji/`，绝不 `git add -A`**（你本地还有 `index.html` 的未提交改动和 `.vs/ backup/ clashAAdd/` 未跟踪目录）：

   ```bash
   cd /d/web/1551114.xyz
   git add dianji
   git commit -m "add dianji ledger"
   git push origin main
   ```

4. GitHub Actions 自动发布 → `https://1551114.xyz/dianji/` 可访问。

### 10.3 DNS

**不动。** 本方案不涉及任何 DNS 记录变更。

---

## 11. 分期实施计划

> **实施状态**：P1、P2、P3 的代码已写入本目录，并通过 `npm test` 的 35 项断言（SHA-256 与标准实现一致、真实历史数据解析与口径、凭据不落盘、409 重试、密码切片与登录）。P4、P5 待做。

| 阶段 | 内容 | 产出 |
|---|---|---|
| **P1** | `index.html` + `config.js` + `calc.js` + `parse.js` + `dianji.css`，数据先存 localStorage；用 §7 的原始文本完成验收 | 本地可用版 + 验收通过 |
| **P2** | `store.js` 接 GitHub Contents API：PAT 首次配置、写入、409 重试、三格式导出 | 手机与电脑共享同一账本 |
| **P3** | 统计卡 + 近 30 天图表 + 耗尽预测告警 + 按人统计（D5） | 完整看板 |
| **P4** | 体验打磨：移动端、离线草稿、（可选）共享口令 | 日常顺手 |
| **P5** | 可选项：账单图片上传（§9.4）、多账本扩容 | 按需 |

---

## 12. 仍然开放（不阻塞 P1）

1. 5 个账号的**显示名**分别是什么？（决定 §5 `config.js` 里的预置名单）
2. 抄表是否只要「早/晚」两档就够？（若需要任意时间点，字段已兼容，只是 UI 要加时间选择器）
3. 是否要在 P4 加一个共享口令作为第二道门？
