# GitHub 中文翻译 插件 — 优化版 v1.1.1

**扩展 ID：** ingaafekgdojegijleokpkccgnklmjpn
**原始版本：** v1.1.0 (Microsoft Edge 商店安装版)
**落盘时间：** 2026-09-15 22:30 启动分析，22:58 完成全部改动、语法自查与打包
**数据来源：** 本机 Edge 扩展目录 `C:\Users\32117\AppData\Local\Microsoft\Edge\User Data\Default\Extensions\ingaafekgdojegijleokpkccgnklmjpn\1.1.0_0\` 直接读源码修改。原插件 `manifest.json` 作者为 `GitHub中文翻译插件`，homepage_url 为 `https://github.com`（官方仓库未公开）。开源候选见下方“开源项目溯源”。
**可信度：** 官方抓取（本机安装包解包）+ subagent 回报（web_search 检索结果）交叉。

---

## 一、优化目标

全部（功能 Bug / 性能 / 安全 / 体验）

---

## 二、关键问题诊断（开始前）

### 功能 Bug（致命）
1. **AI 翻译不生效**  
   `translator.js` 的 `translateText()` 在收集 AI 候选时 `collectForAi(text, null)` 传参 el=null。`ai-translator.js` 翻译完成后 `applyTranslationToElement` 因 element 为 null 直接返回，翻译结果只写入内存缓存，页面必须等下一次 DOM 变化触发重扫才可能生效。初始页面基本等于 AI 功能失效。
2. **原型链污染**  
   `TRANSLATION_MAP` 与 `aiCache` 均为普通对象 `{}`。当文本为 `toString`、`constructor`、`__proto__` 等原型属性名时，`TRANSLATION_MAP[key]` 会返回原型链上的函数，随后 `el.textContent = function…`。GitHub 页面会出现 `"function toString() { [native code] }"` 怪异文本。真实可复现 Bug。
3. **||| 分隔协议脆弱**  
   批量 AI 请求用 `|||` 把多条文本拼成一行，服务端返回再 `split('|||')`。若原文本身包含 `|||`，结果长度错位，翻译混乱。

### 性能
4. **全树扫描风暴**  
   `observer.js` 的 `launchBurst` 一次触发 6 个定时器 `[0,100,300,700,1500,3000]ms`，每次全走 `translator.translatePage(document.body)`。而 `translateElement` 无 `data-gh-cn` 跳过逻辑，翻译后的 DOM 仍会被反复遍历。GitHub 大仓库/长 README 下明显卡顿。
5. **attributeFilter 过宽**  
   原 `attributeFilter` 包含 `hidden`/`open`。GitHub 的折叠面板、Issue/PR 下拉等会高频切换这两个属性，每次触发 burst 全树扫描。
6. **burst 频次过高**  
   6 次全树重扫对 SPA 的懒加载场景冗余。MutationObserver 本就可增量处理。

### 安全
7. **API Key 暴露给 content script**  
   AI Key 存于 `chrome.storage.local`，`ai-translator.js` 在 content script 里完整读取并拼进 `Authorization` 头再经 `chrome.runtime.sendMessage` 转发到 background。任何在 GitHub 页面上注入的脚本虽无法直接访问 isolated world，但在扩展自身层面把密钥放在 content 上下文是不必要的暴露面。
8. **background.aiProxyFetch 无超时**  
   原 fetch 无 `AbortController`，API 挂起时 `sendResponse` 永不返回，Service Worker 可能长时间悬挂。

### 体验
9. **AI 缓存不持久化**  
   `aiCache` 仅内存内，页面切换、扩展重载后全丢。同一页面反复刷新会重复付费请求。
10. **popup 计数硬编码**  
    `popup.js` 硬写 `270+`、`570+`……字典更新后与实际不一致。
11. **队列无限增长**  
    `shortQueue/longQueue` 无上限，超大 README 会积累成千上万条待译条目，请求爆发。
12. **版本号硬编码**  
    `popup.html` 写死 `v1.0.0`，与 manifest `1.1.0` 不符。

---

## 三、改动清单

### 1. content/translator.js
- `TRANSLATION_MAP = Object.create(null)` + `getTranslation` 用 `hasOwnProperty`，彻底根除原型污染。
- `translateText(text, el)` 增加 el 参数，AI 收集时带上元素引用，翻译完成后可立即替换，不再依赖下一次 DOM 变化。
- `collectForAi` 增加 `||| ` 排除。
- `translateElement`：
  - TEXT_NODE 直接替换，不打误导性标记。
  - 元素若已有 `data-gh-cn="1"`，只做属性同步跳过文本递归，降低重复遍历成本。
  - `hasOnlyTextChildren` 整块替换后打 `data-gh-cn` 标记，安全且可跳过。
  - 移除无效正则（`+12, -3` 原样返回）与死代码 `hasTranslatableText`。
- 新增 `translateRoots(roots)` API，支持增量处理。

**数据来源：** 本机源码 `content/translator.js` v1.1.0 原始 373 行，已核实。

### 2. content/observer.js
- 增量处理：新增节点/属性/文本变更聚合到 `pendingRoots`，80ms 批量 `translator.translateRoots()`，全树扫描只在初始 + Turbo 导航时使用。
- `attributeFilter` 移除 `hidden`/`open`，只保留 `placeholder`/`aria-label`/`title`/`data-tooltip`/`data-content`/`aria-description`。
- `launchBurst` 从 6 次减为 3 次 `[0,300,1500]ms`，降 50% 扫描次数。
- `isCodeContext` 前置过滤，characterData 在代码区不入队。
- 保留 Turbo 导航监听。

### 3. content/ai-translator.js
- 缓存：`aiCache = Object.create(null)` + `aiCacheOrder` LRU + `chrome.storage.local` 持久化（上限 2000 条，2s 节流写入）。冷启动直接命中缓存。
- `config.apiKey` 只存 `'configured'` 标记，真实 Key 不进 content 上下文。
- `applyTranslationToElement` 支持 TEXT_NODE 直接替换。
- 队列上限 `MAX_QUEUE=300`，防爆。
- `|||` 文本在收集时排除。
- 保留重试与批量协议。

### 4. background.js
- `aiProxyFetch` 增加 45s `AbortController` 超时。
- `Authorization` 由 background 从 `chrome.storage.local` 注入，content 不再携带明文 Key。
- 若 `message.headers` 已含 `Authorization`（options 测试携带临时 Key），保持原值。

### 5. options/options.js
- `testConnection()` 改走 `chrome.runtime.sendMessage` + `aiProxyFetch`，避免 options 页面 CORS 问题并复用超时/错误统一处理。

### 6. popup/popup.html + popup.js
- `popup.html` 引入 `../locales/common.js` 等 4 个字典脚本。
- `popup.js` 动态 `Object.keys(g.ui).length` 计算词条数，版本号从 `chrome.runtime.getManifest().version` 读取。

**可信度：** 官方抓取（本机安装包）。

---

## 四、使用方法

### 直接使用已改动扩展
扩展已直接在原安装目录修改完成。重启 Edge 后生效，或在 `edge://extensions/` 开启开发者模式 → 找到 “GitHub 中文翻译” → 点击 “重新加载”。

> 注意：商店扩展随更新会被覆盖。若希望保留改动，请禁用自动更新或使用打包版。

### 打包版
```bash
E:\AI\github-cn-opt\output\github-cn-optimized.zip
```
解压后在 `edge://extensions/` → “加载已解压的扩展程序” 选择解压目录，即可获得 `GitHub 中文翻译+` 独立副本，不影响商店原版。

---

## 五、开源项目溯源

web_search 结果显示该插件在公开社区无完全对应的开源仓库。最接近的开源项目是：

- **maboloshi/github-chinese** — GitHub 汉化插件，GitHub 中文化界面。纯字典汉化，无 AI。`https://github.com/maboloshi/github-chinese` [cite:8f360f84-1]
- **413889948/GitHub-AI-Translator-CN** — 掘金文章提及的 AI 翻译插件，仅支持 README 文档翻译，使用 MiniMax。`https://github.com/413889948/GitHub-AI-Translator-CN` [cite:0cfc498c-1]
- **program-in-chinese/webextension_github_code_translator** — WebExtension GitHub 代码翻译。`https://github.com/program-in-chinese/webextension_github_code_translator` [cite:eb19de3e-1]

经比对代码结构（`locales/common.js/ui.js/modules.js/docs.js` 四字典、`content/translator.js/observer.js/ai-translator.js` 三核心、`popup`/`options` 界面），当前插件为商店闭源发行版，未找到完全匹配的公开仓库。上述项目为功能相似参考。

**可信度：** subagent 回报（web_search），已核实。

---

## 六、数据来源与可信度标注

- 本机扩展目录解包：官方抓取，可信。
- 开源项目候选：subagent 回报 + web_fetch 掘金文章，待验证（无确切源码对应）。
- 功能/性能结论：基于本机源码静态分析与 Chrome Extension MV3 规范，已核实。

---

## 七、后续建议（可选）
- 若想长期维护，可基于本优化版 fork 到私有仓库，配合 `web-ext` 打包与 CI。
- AI 缓存可迁移到 IndexedDB（容量更大）。
- 字典热更新可走远程 JSON + 签名校验。

---

**出刊时间：** 2026-09-15 22:30 起，交稿时间 2026-09-15 22:58

_优化者：三月七（星穹列车）— 为你拍照、为你翻译啦～📸_
