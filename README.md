# AI Git Reviewer

> Gemini / Claude / OpenAI 驱动的 GitHub & GitLab 代码审查 Chrome 扩展（Side Panel）

![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)
![Plasmo](https://img.shields.io/badge/Plasmo-0.90.5-7C3AED)
![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)

## 功能概览

- **多平台 Diff**：支持 GitHub（Octokit）与 GitLab（REST API）两个 Commit Hash 之间的 Diff 获取。
- **仓库地址自动识别**：打开 Side Panel 时，会优先从当前标签页 URL 自动提取 GitHub `owner/repo` 或 GitLab `group/subgroup/project`；自托管 GitLab 会同时带出当前页面域名作为 API 根地址。
- **Token 感知分片**：`DiffBuffer` 自动检测 Diff 是否超出模型上下文窗口，超限时按文件粒度拆分（单文件超限再按 Hunk 块拆分），各分片先生成摘要，最后汇总出完整审查报告。
- **实时流式输出**：Background Service Worker 通过 `chrome.runtime.Port` 长连接将 LLM delta 实时推送至 Side Panel，逐字展示。
- **多模型原生支持**：
  - **Gemini 3.1 Flash / Pro**：超长上下文支持（达 1M+ tokens）。
  - **Claude Sonnet 4.6 / Opus 4.6**：深度逻辑与架构建议。
  - **OpenAI GPT-5 Mini / GPT-5.4**：通过官方 OpenAI SDK 的 Responses API 进行流式审查。
- **请求前置校验**：正式拉取 Diff 之前，会先校验 GitHub/GitLab 仓库或项目是否存在，把“项目错了”和“Commit 错了”拆开提示。
- **鲁棒性增强**：
  - 针对 Claude API 的 JSON 序列化限制，内置 Unicode 清洗逻辑（`ensureWellFormed`），解决 `no low surrogate` 报错。
  - OpenAI 路径不使用 `instructions` 字段，而是将 system prompt 合并进 `input`，规避扩展场景下的 500 问题。
- **会话级凭证存储**：API Keys 仅保存在当前浏览器会话中；默认偏好等非敏感配置保存在本地扩展存储。
- **一键复制**：审查完成后，可快速将 Markdown 报告复制到剪切板。

## 技术栈

| 层   | 技术                                                     |
| ---- | -------------------------------------------------------- |
| 框架 | [Plasmo](https://docs.plasmo.com/) 0.90.5                |
| UI   | React 18 + Tailwind CSS + Lucide Icons                   |
| LLM  | `@google/generative-ai` + `@anthropic-ai/sdk` + `openai` |
| Git  | `@octokit/rest` + GitLab REST API                        |
| 渲染 | **marked** + **DOMPurify** (高性能流式安全渲染)          |

> **注：** 为了在 Plasmo/esbuild 环境下获得最佳兼容性，我们从 `react-markdown` 迁移到了更底层的 `marked` 解析器，解决了打包时的路径解析与节点处理崩溃问题。

## 架构

```
Side Panel ──port.connect──► Background Service Worker
                                  │
                                  ├─ 当前页面 URL 识别
                                  │    ├─ GitHub: owner/repo
                                  │    └─ GitLab: group/subgroup/project
                                  │
                                  ├─ DiffEngine.fetchDiff()
                                  │    ├─ 仓库/项目预检查
                                  │    ├─ GitHub: Octokit compareCommits (分页)
                                  │    └─ GitLab: REST /repository/compare (分页)
                                  │
                                  ├─ DiffBuffer.chunk()
                                  │    └─ Token 感知：文件粒度 → Hunk 粒度降级
                                  │
                                  └─ LLMClient.review()
                                       ├─ Unicode 清洗：避免 Claude 发包 400 错误
                                       ├─ PromptBundle: 统一 system/user 语义
                                       ├─ Gemini: generateContentStream
                                       ├─ Claude: messages.stream
                                       └─ OpenAI: responses.create(stream)
                                             │
                                             └─ port.postMessage(delta) ──► Side Panel
```

## 目录结构

```
src/
├── background.ts        # Service Worker 核心（Git Diff + 流式中转）
├── sidepanel.tsx        # Side Panel 主 UI（Markdown 渲染 + 交互）
├── options.tsx          # 配置页（API Keys 管理 + 一键抹除）
├── core/
│   ├── storage.ts       # SecurityManager（加密及安全存储逻辑）
│   ├── diff-engine.ts   # DiffEngine + DiffBuffer Token 分片算法
│   └── llm.ts           # LLMClient（多模型适配器 + 稳定性修复）
├── types/
│   └── index.ts         # 严格的 TypeScript 类型定义
└── styles/
    └── globals.css      # 现代感的暗色主题与微动画
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 开发模式

```bash
npm run dev
# 构建产物位于 build/chrome-mv3-dev/
```

### 3. 设置 API 密钥

1. 右键扩展图标 -> **选项**
2. 填入你的对应 Token 与 API Key（Gemini / Claude / OpenAI 至少一个）。
3. 如使用 GitLab 自托管，可填写实例根地址（例如 `https://git.joyobpo.net`）；如果你是在对应 GitLab 仓库页面里打开 Side Panel，也可以留空，扩展会优先自动识别当前域名。
4. 首次执行审查前，需要在侧边栏确认数据传输说明。
5. 使用 GitLab 时，扩展会在首次访问当前 GitLab 域名时请求一次运行时站点权限，不会把某个固定 GitLab 域名写成必需权限。
6. 打开任意 GitHub / GitLab 仓库页面后再展开 Side Panel，项目路径会优先自动识别。

## 仓库自动识别

扩展会在 Side Panel 初始化时读取当前活动标签页 URL，并尝试自动推断项目标识：

- GitHub：`https://github.com/owner/repo/...` -> `owner/repo`
- GitLab：`https://git.example.com/group/subgroup/project/commits/branch` -> `group/subgroup/project`
- GitLab：`https://git.example.com/group/project/-/merge_requests/123` -> `group/project`

如果当前页面不是可识别的仓库页面，才会回退到本地配置中的默认项目。

## 错误提示策略

为了减少“看起来像同一个错误，实际原因却不同”的排障成本，Git 数据拉取现在分两步：

1. 先验证仓库/项目是否存在，以及 Token 是否有权限访问。
2. 再请求 Compare 接口，校验 Base / Head Commit 是否有效。

因此现在会区分下面两类报错：

- `未找到对应的 GitHub/GitLab 仓库(项目)`：优先检查 `Project ID`、GitLab Base URL、Token 权限。
- `未找到对应的 Commit`：项目存在，但 Base / Head Hash 不正确，或两者无法比较。

## Token 分片逻辑（智能上下文管理）

当 Diff 内容过大（如一次性 PR 几百个文件）时，系统会自动启用分段处理策略：

1. **分段**：按照模型可承受的输入 Token 窗口对文件进行分组。
2. **初步摘要**：每组独立调用 LLM 生成描述核心变更的技术摘要。
3. **最终报告**：将所有摘要拼接，由模型进行全局综合分析，输出结构化的完整审查意见。

## 开发与贡献

```bash
# 类型检查
npm run typecheck

# 生产构建
npm run build
```

## License

MIT
