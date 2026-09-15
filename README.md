# GitHub 中文翻译 优化版（社区维护 fork）

> **说明情况**：本仓库是微软 Edge / Chrome 商店扩展「GitHub 中文翻译」（版本 v1.1.0，扩展 ID `ingaafekgdojegijleokpkccgnklmjpn`）的**本地优化版本**。原作者在商店发行的是闭源版本，官方未公开源代码仓库。本仓库基于本机安装包解包修改，仅用于个人学习与技术研究，**再分发请遵守原作者的最终许可**。

**联系方式**：mowenqwq@163.com

---

## 这是什么

一款 Chrome / Edge 扩展，自动把 GitHub 页面（界面、README、Issue 等）翻译为简体中文。支持两种模式：

- **字典翻译**：内置 1700+ 词条（`locales/` 四个字典文件），离线即时替换，不消耗 API。
- **AI 翻译**：对字典未覆盖的文案，调用用户自有 AI 模型翻译（支持 OpenAI 兼容端点、MiniMax 等）。

## 本次优化内容（v1.1.1）

| 类别 | 问题 | 修复 |
|------|------|------|
| 功能 | AI 翻译失效（收集候选时未传 DOM 节点，翻译结果只进缓存不替换页面） | `translateText` 带上元素引用，翻译完成后立即替换 |
| 功能 | 原型链污染（`toString`/`constructor`/`__proto__` 等键命中原型，写出 `function toString(){...}`） | `TRANSLATION_MAP` / `aiCache` 改用 `Object.create(null)` |
| 功能 | 批量 AI 翻译用 `|||` 拼接，原文含 `|||` 时错位 | 收集时排除含分隔符的文本 |
| 性能 | MutationObserver 每次全树扫描 + 6 次 burst | 改为增量处理，burst 降到 3 次，去掉 `hidden`/`open` 高频属性监听 |
| 安全 | API Key 在 content script 明文暴露 | Key 仅存 background，由 Service Worker 注入 `Authorization`；fetch 增加 45s 超时 |
| 体验 | AI 缓存不持久、popup 计数与版本号硬编码 | 缓存落 `chrome.storage.local`；popup 动态统计词条数 + 版本号从 manifest 读取 |

完整诊断与改动清单见 [`DIAGNOSIS.md`](./DIAGNOSIS.md)（内部文档）。

## 使用方法

**方式一：加载已解压扩展（推荐）**
1. 下载本仓库 `output/github-cn-optimized.zip` 并解压，或 `git clone` 后取根目录文件。
2. 打开浏览器扩展管理页（`edge://extensions` 或 `chrome://extensions`）。
3. 开启「开发者模式」→「加载已解压的扩展程序」→ 选择解压目录。

**方式二：直接覆盖商店版（高级）**
将本仓库根目录文件覆盖到浏览器扩展安装目录对应子目录（需先关闭自动更新或锁定版本）。

## AI 翻译配置

在扩展 popup → 设置中填写：
- **API 端点**：如 `https://api.openai.com/v1/chat/completions`
- **API Key**：仅保存在本地，由后台注入请求
- **模型**：如 `gpt-3.5-turbo` / `DeepSeek-V3` 等 OpenAI 兼容模型

## 许可证

代码以 [MIT License](./LICENSE) 发布。但请注意：本作品衍生自闭源第三方扩展，再分发前请确认不违反原作者的发行条款。

---

*本仓库由社区用户维护，与原作者无隶属关系。如有侵权或下架诉求，请联系 mowenqwq@163.com。*
