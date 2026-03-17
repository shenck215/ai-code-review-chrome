# AI Git Reviewer

> Gemini / Claude 驱动的 GitHub & GitLab 代码审查 Chrome 扩展（Side Panel）

![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)
![Plasmo](https://img.shields.io/badge/Plasmo-0.90.5-7C3AED)
![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)

## 功能概览

- **多平台 Diff**：支持 GitHub（Octokit）与 GitLab（REST API）两个 Commit Hash 之间的 Diff 获取。
- **Token 感知分片**：`DiffBuffer` 自动检测 Diff 是否超出模型上下文窗口，超限时按文件粒度拆分（单文件超限再按 Hunk 块拆分），各分片先生成摘要，最后汇总出完整审查报告。
- **实时流式输出**：Background Service Worker 通过 `chrome.runtime.Port` 长连接将 LLM delta 实时推送至 Side Panel，逐字展示。
- **多模型原生支持**：
  - **Gemini 2.0/1.5**：超长上下文支持（达 1-2M tokens）。
  - **Claude 3.5/3.7**：深度逻辑与架构建议。
- **鲁棒性增强**：针对 Claude API 的 JSON 序列化限制，内置 Unicode 清洗逻辑（`ensureWellFormed`），彻底解决 `no low surrogate` 报错。
- **安全存储**：API Keys 存储在 `chrome.storage.local`，仅限本地，支持一键安全抹除。
- **一键复制**：审查完成后，可快速将 Markdown 报告复制到剪切板。

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | [Plasmo](https://docs.plasmo.com/) 0.90.5 |
| UI | React 19 + Tailwind CSS + Lucide Icons |
| LLM | `@google/generative-ai` + `@anthropic-ai/sdk` |
| Git | `@octokit/rest` + GitLab REST API |
| 渲染 | **marked** + **DOMPurify** (高性能流式安全渲染) |

> **注：** 为了在 Plasmo/esbuild 环境下获得最佳兼容性，我们从 `react-markdown` 迁移到了更底层的 `marked` 解析器，解决了打包时的路径解析与节点处理崩溃问题。

## 架构

```
Side Panel ──port.connect──► Background Service Worker
                                  │
                                  ├─ DiffEngine.fetchDiff()
                                  │    ├─ GitHub: Octokit compareCommits (分页)
                                  │    └─ GitLab: REST /repository/compare (分页)
                                  │
                                  ├─ DiffBuffer.chunk()
                                  │    └─ Token 感知：文件粒度 → Hunk 粒度降级
                                  │
                                  └─ LLMClient.review()
                                       ├─ Unicode 清洗：避免 Claude 发包 400 错误
                                       ├─ Gemini: generateContentStream
                                       └─ Claude: messages.stream
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
2. 填入你的对应 Token 与 API Key。
3. 扩展内置了 GitLab 自托管 URL 支持。

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
