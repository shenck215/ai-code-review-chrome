// ===================== Git 相关类型 =====================

export type GitPlatform = "github" | "gitlab";

export interface GitConfig {
  platform: GitPlatform;
  token: string;
  /** GitHub: "owner/repo"，GitLab: projectId (数字或 encoded path) */
  projectId: string;
  /** GitLab 自托管实例 URL，默认 https://gitlab.com */
  gitlabBaseUrl?: string;
}

export interface DiffFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch: string;
  oldFilename?: string;
}

export interface DiffPayload {
  baseCommit: string;
  headCommit: string;
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  /** 原始 patch 字符串的 token 估算值 */
  estimatedTokens: number;
}

export interface DiffChunk {
  index: number;
  total: number;
  files: DiffFile[];
  estimatedTokens: number;
}

// ===================== LLM 相关类型 =====================

export type ModelProvider = "gemini" | "claude" | "openai";

export type GeminiModel =
  | "gemini-3.1-flash-lite-preview"
  | "gemini-3.1-pro-preview";

export type ClaudeModel = "claude-sonnet-4-6" | "claude-opus-4-6";

export type OpenAIModel = "gpt-5-mini" | "gpt-5.4";

export type ModelId = GeminiModel | ClaudeModel | OpenAIModel;

export interface ModelConfig {
  provider: ModelProvider;
  modelId: ModelId;
  modelName: string;
  /** token 上下文限制 */
  contextWindowTokens: number;
  /** 保留给输出的 token 数 */
  maxOutputTokens: number;
}

export const MODEL_CONFIGS: Record<ModelId, ModelConfig> = {
  "gemini-3.1-flash-lite-preview": {
    provider: "gemini",
    modelId: "gemini-3.1-flash-lite-preview",
    modelName: "Gemini 3.1 Flash",
    contextWindowTokens: 1048576,
    maxOutputTokens: 65536,
  },
  "gemini-3.1-pro-preview": {
    provider: "gemini",
    modelId: "gemini-3.1-pro-preview",
    modelName: "Gemini 3.1 Pro",
    contextWindowTokens: 1048576,
    maxOutputTokens: 65536,
  },
  "claude-sonnet-4-6": {
    provider: "claude",
    modelId: "claude-sonnet-4-6",
    modelName: "Claude Sonnet 4.6",
    contextWindowTokens: 1000000,
    maxOutputTokens: 64000,
  },
  "claude-opus-4-6": {
    provider: "claude",
    modelId: "claude-opus-4-6",
    modelName: "Claude Opus 4.6",
    contextWindowTokens: 1000000,
    maxOutputTokens: 64000,
  },
  "gpt-5-mini": {
    provider: "openai",
    modelId: "gpt-5-mini",
    modelName: "GPT-5 Mini",
    contextWindowTokens: 272000,
    maxOutputTokens: 128000,
  },
  "gpt-5.4": {
    provider: "openai",
    modelId: "gpt-5.4",
    modelName: "GPT-5.4",
    contextWindowTokens: 272000,
    // contextWindowTokens: 1050000, // 单次超过 272k token 费用计价提高
    maxOutputTokens: 128000,
  },
};

// ===================== 消息通信类型 =====================

export type MessageType =
  | "REVIEW_START"
  | "STREAM_DELTA"
  | "STREAM_DONE"
  | "STREAM_ERROR"
  | "REVIEW_PROGRESS";

export interface ReviewRequest {
  baseCommit: string;
  headCommit: string;
  gitConfig: GitConfig;
  modelId: ModelId;
  geminiApiKey: string;
  claudeApiKey: string;
  openaiApiKey: string;
}

export interface StreamMessage {
  type: MessageType;
  payload?: {
    delta?: string;
    error?: string;
    progress?: ReviewProgress;
    fullContent?: string;
  };
}

export interface ReviewProgress {
  stage:
    | "fetching_diff"
    | "chunking"
    | "reviewing_chunk"
    | "summarizing"
    | "done";
  currentChunk?: number;
  totalChunks?: number;
  message: string;
}

// ===================== 存储类型 =====================

export interface AppConfig {
  /** GitHub Personal Access Token */
  githubToken: string;
  /** GitLab Personal Access Token */
  gitlabToken: string;
  /** GitLab 自托管 URL */
  gitlabBaseUrl: string;
  /** Gemini API Key */
  geminiApiKey: string;
  /** Anthropic API Key */
  claudeApiKey: string;
  /** OpenAI API Key */
  openaiApiKey: string;
  /** 默认模型 */
  defaultModel: ModelId;
  /** 默认平台 */
  defaultPlatform: GitPlatform;
  /** 默认项目 */
  defaultProject: string;
}

export type PartialAppConfig = Partial<AppConfig>;
