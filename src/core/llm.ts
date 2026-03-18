/**
 * llm.ts - 大语言模型客户端集成
 *
 * 核心职责：
 * 1. 统一封装 Gemini 和 Claude 的流式接口。
 * 2. 处理 Unicode 编码异常（针对 Claude API 的稳定性修复）。
 * 3. 实现 Token 敏感的 Diff 分片和汇总逻辑，解决超长 Diff 的审查难题。
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { DiffChunk, DiffPayload, ModelId } from "~types";
import { MODEL_CONFIGS } from "~types";
import { DiffBuffer } from "./diff-engine";

export type StreamCallback = (delta: string) => void;
export type ProgressCallback = (msg: string) => void;

/**
 * 确保字符串符合 Unicode 规范，移除无效的代理项（Unpaired Surrogates）。
 *
 * 为什么需要：
 * Claude API (Anthropic SDK) 在处理包含孤立代理项字符的字符串时，
 * 其内部 JSON.stringify 会产生无效 JSON，导致 API 返回 400 错误。
 */
function ensureWellFormed(str: string): string {
  if (typeof str.toWellFormed === "function") {
    return str.toWellFormed();
  }
  // 回退处理：使用正则替换所有孤立的高低代理项字符为替换字符 (U+FFFD)
  return str.replace(
    /([\uD800-\uDBFF](?![\uDC00-\uDFFF]))|((?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/g,
    "\uFFFD",
  );
}

// ── 系统提示：定义 AI 审查专家的角色和报告结构 ──
const SYSTEM_PROMPT = `你是一位世界级的代码审查专家，有着深厚的软件工程经验。
请按以下结构输出审查报告（使用中文）：

## 📊 变更概览
- 涉及文件数量、新增/删除行数、主要变更领域

## 🔍 关键问题（按严重程度排序）
- 🔴 **严重**：安全漏洞、数据丢失风险、性能致命问题
- 🟠 **重要**：逻辑错误、边界情况处理不当
- 🟡 **建议**：代码质量、可读性、最佳实践

## ✅ 亮点
- 值得肯定的优秀实践

## 💡 改进建议
- 具体的重构或优化方案，附带代码示例

输出格式：Markdown，代码片段使用对应语言的 fence 块。`;

/**
 * 中间摘要提示：用于长 Diff 分片处理
 */
const CHUNK_SUMMARY_PROMPT = (index: number, total: number) =>
  `以下是第 ${index + 1}/${total} 批文件的 Diff。请提供一份简洁的中间摘要（500字以内），
聚焦于这批文件中的关键问题和重要变更，后续将与其他批次合并汇总。`;

/**
 * 最终汇总提示：将各分片摘要合义为最终报告
 */
const FINAL_SUMMARY_PROMPT = `以下是各批次 Diff 的中间摘要，请综合所有内容，
输出一份完整、深入的代码审查报告（格式同系统提示）。`;

/**
 * 将 Diff 对象格式化为便于 LLM 理解的提示文本
 */
function formatDiffForPrompt(payload: DiffPayload | DiffChunk): string {
  const files = "files" in payload ? payload.files : (payload as any).files;
  return files
    .map(
      (f: any) =>
        `### ${f.filename} [${f.status}] (+${f.additions} -${f.deletions})\n\`\`\`diff\n${f.patch}\n\`\`\``,
    )
    .join("\n\n");
}

/**
 * Gemini 流式客户端封装
 * 使用 @google/generative-ai SDK
 */
async function streamGemini(
  apiKey: string,
  modelId: string,
  prompt: string,
  onDelta: StreamCallback,
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: SYSTEM_PROMPT,
  });

  const result = await model.generateContentStream(prompt);
  let full = "";

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      onDelta(text);
      full += text;
    }
  }
  return full;
}

/**
 * Claude 流式客户端封装
 * 使用 @anthropic-ai/sdk
 * 特别注意：增加了 Unicode 清洗以防止 400 编码错误
 */
async function streamClaude(
  apiKey: string,
  modelId: string,
  prompt: string,
  onDelta: StreamCallback,
): Promise<string> {
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true, // 允许在 Chrome Extension 环境运行
  });

  const cfg = MODEL_CONFIGS[modelId as ModelId];
  const stream = await client.messages.stream({
    model: modelId,
    max_tokens: cfg.maxOutputTokens,
    system: ensureWellFormed(SYSTEM_PROMPT), // 清洗系统提示
    messages: [{ role: "user", content: ensureWellFormed(prompt) }], // 清洗用户输入
  });

  let full = "";
  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      onDelta(chunk.delta.text);
      full += chunk.delta.text;
    }
  }
  return full;
}

/**
 * OpenAI 流式客户端封装
 * 使用官方 openai SDK 的 Responses API
 */
async function streamOpenAI(
  apiKey: string,
  modelId: string,
  prompt: string,
  onDelta: StreamCallback,
): Promise<string> {
  const cfg = MODEL_CONFIGS[modelId as ModelId];
  const client = new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true,
  });

  const stream = await client.responses.create({
    model: modelId,
    instructions: SYSTEM_PROMPT,
    input: prompt,
    max_output_tokens: cfg.maxOutputTokens,
    stream: true,
    reasoning: {
      effort: "medium",
    },
  });

  let full = "";
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      onDelta(event.delta);
      full += event.delta;
    }
  }

  return full;
}

/**
 * 统一流式调用入口：根据模型 ID 选择对应的 Provider
 */
async function streamReview(
  modelId: ModelId,
  geminiApiKey: string,
  claudeApiKey: string,
  openaiApiKey: string,
  prompt: string,
  onDelta: StreamCallback,
): Promise<string> {
  const cfg = MODEL_CONFIGS[modelId];
  if (cfg.provider === "gemini") {
    return streamGemini(geminiApiKey, modelId, prompt, onDelta);
  }
  if (cfg.provider === "claude") {
    return streamClaude(claudeApiKey, modelId, prompt, onDelta);
  }
  return streamOpenAI(openaiApiKey, modelId, prompt, onDelta);
}

/**
 * LLMClient：代码审查的核心业务逻辑类
 * 负责调度分段逻辑和结果汇总
 */
export class LLMClient {
  private modelId: ModelId;
  private geminiApiKey: string;
  private claudeApiKey: string;
  private openaiApiKey: string;
  private buffer: DiffBuffer;

  constructor(
    modelId: ModelId,
    geminiApiKey: string,
    claudeApiKey: string,
    openaiApiKey: string,
  ) {
    this.modelId = modelId;
    this.geminiApiKey = geminiApiKey;
    this.claudeApiKey = claudeApiKey;
    this.openaiApiKey = openaiApiKey;
    this.buffer = new DiffBuffer(modelId); // 初始化分片管理器
  }

  /**
   * 执行审查的核心流程
   *
   * @param payload 包含整个 Diff 的荷载
   * @param onDelta 流式文本回调，用于实时更新 UI
   * @param onProgress 进度消息回调，告知用户当前阶段
   */
  async review(
    payload: DiffPayload,
    onDelta: StreamCallback,
    onProgress: ProgressCallback,
  ): Promise<void> {
    // 检查是否需要分片
    if (!this.buffer.needsChunking(payload)) {
      // ── 情况 A：单次全量审查 ──
      onProgress(`🔍 正在审查 ${payload.files.length} 个文件...`);
      const prompt =
        `请审查以下代码变更（${payload.baseCommit.slice(0, 7)} → ${payload.headCommit.slice(0, 7)}）：\n\n` +
        formatDiffForPrompt(payload);

      await streamReview(
        this.modelId,
        this.geminiApiKey,
        this.claudeApiKey,
        this.openaiApiKey,
        prompt,
        onDelta,
      );
      return;
    }

    // ── 情况 B：Diff 过大，分批异步审查 ──
    const chunks = this.buffer.chunk(payload);
    onProgress(`⚡ Diff 较大，将分 ${chunks.length} 批处理...`);

    const summaries: string[] = [];

    // 逐批生成各部分的中间摘要
    for (const chunk of chunks) {
      onProgress(
        `🔍 正在审查第 ${chunk.index + 1}/${chunk.total} 批（${chunk.files.length} 个文件）...`,
      );

      const prompt =
        CHUNK_SUMMARY_PROMPT(chunk.index, chunk.total) +
        "\n\n" +
        formatDiffForPrompt(chunk);

      // 分片摘要也推进到 UI，让用户看到中间进度
      onDelta(`\n\n---\n### 第 ${chunk.index + 1}/${chunk.total} 批摘要\n\n`);
      const summary = await streamReview(
        this.modelId,
        this.geminiApiKey,
        this.claudeApiKey,
        this.openaiApiKey,
        prompt,
        onDelta,
      );
      summaries.push(summary);
    }

    // ── 综合汇总：将所有摘要合称为最终报告 ──
    onProgress("🧠 正在汇总所有批次，生成完整审查报告...");
    onDelta(`\n\n---\n## 🏁 综合审查报告\n\n`);

    const finalPrompt =
      FINAL_SUMMARY_PROMPT +
      "\n\n" +
      summaries
        .map((s, i) => `### 第 ${i + 1} 批摘要\n${s}`)
        .join("\n\n---\n\n");

    await streamReview(
      this.modelId,
      this.geminiApiKey,
      this.claudeApiKey,
      this.openaiApiKey,
      finalPrompt,
      onDelta,
    );
  }
}
