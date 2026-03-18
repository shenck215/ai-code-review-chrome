import { Storage } from "@plasmohq/storage";
import type { AppConfig, PartialAppConfig } from "~types";

// 所有敏感 key 使用 chrome.storage.local（不同步到云端）
const storage = new Storage({ area: "local" });

const CONFIG_KEY = "app_config";

const DEFAULT_CONFIG: AppConfig = {
  githubToken: "",
  gitlabToken: "",
  gitlabBaseUrl: "https://gitlab.com",
  geminiApiKey: "",
  claudeApiKey: "",
  openaiApiKey: "",
  defaultModel: "gemini-3.1-flash-lite-preview",
  defaultPlatform: "github",
  defaultProject: "",
};

export class SecurityManager {
  private static instance: SecurityManager;
  private cache: AppConfig | null = null;

  static getInstance(): SecurityManager {
    if (!SecurityManager.instance) {
      SecurityManager.instance = new SecurityManager();
    }
    return SecurityManager.instance;
  }

  private constructor() {
    // 监听存储变化，自动同步缓存
    storage.watch({
      [CONFIG_KEY]: (c) => {
        this.cache = { ...DEFAULT_CONFIG, ...((c.newValue as AppConfig) ?? {}) };
      },
    });
  }

  /** 读取完整配置 */
  async getConfig(): Promise<AppConfig> {
    const stored = await storage.get<AppConfig>(CONFIG_KEY);
    this.cache = { ...DEFAULT_CONFIG, ...(stored ?? this.cache ?? {}) };
    return this.cache;
  }

  /** 更新部分配置 */
  async updateConfig(patch: PartialAppConfig): Promise<void> {
    const current = await this.getConfig();
    const updated = { ...current, ...patch };
    this.cache = updated;
    await storage.set(CONFIG_KEY, updated);
  }

  /** 读取单个配置项 */
  async get<K extends keyof AppConfig>(key: K): Promise<AppConfig[K]> {
    const config = await this.getConfig();
    return config[key];
  }

  /**
   * 🔴 一键抹除所有敏感数据
   * 清空 chrome.storage.local 中的所有内容
   */
  async nukeSensitiveData(): Promise<void> {
    await chrome.storage.local.clear();
    this.cache = null;
  }

  /** 验证配置是否完整（指定平台所需的 key 是否已填写） */
  async validateConfig(platform: "github" | "gitlab"): Promise<{
    valid: boolean;
    missing: string[];
  }> {
    const config = await this.getConfig();
    const missing: string[] = [];

    if (platform === "github" && !config.githubToken) {
      missing.push("GitHub Token");
    }
    if (platform === "gitlab" && !config.gitlabToken) {
      missing.push("GitLab Token");
    }
    if (!config.geminiApiKey && !config.claudeApiKey && !config.openaiApiKey) {
      missing.push("Gemini / Claude / OpenAI API Key（至少一个）");
    }

    return { valid: missing.length === 0, missing };
  }

  /** 检测 API Key 格式（简单启发式前缀验证） */
  static validateKeyFormat(
    key: string,
    type: "gemini" | "claude" | "openai" | "github" | "gitlab",
  ): boolean {
    if (!key || key.trim().length === 0) return false;
    switch (type) {
      case "gemini":
        return key.startsWith("AIza") && key.length > 30;
      case "claude":
        return key.startsWith("sk-ant-") && key.length > 40;
      case "openai":
        return key.startsWith("sk-") && key.length > 20;
      case "github":
        return (
          key.startsWith("ghp_") ||
          key.startsWith("github_pat_") ||
          key.length > 20
        );
      case "gitlab":
        return key.length > 10;
      default:
        return key.length > 0;
    }
  }

  /** 脱敏显示（保留前4后4字符） */
  static maskKey(key: string): string {
    if (!key || key.length < 10) return "••••••••";
    return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
  }
}

export const securityManager = SecurityManager.getInstance();
