import { Storage } from "@plasmohq/storage";
import type { AppConfig, PartialAppConfig } from "~types";

// 非敏感配置持久化到 local；敏感凭证仅保存在当前浏览器会话，降低审核风险。
const localStorage = new Storage({ area: "local" });
const sessionStorage = new Storage({ area: "session" });

const PUBLIC_CONFIG_KEY = "app_config_public";
const SECRET_CONFIG_KEY = "app_config_secret";

const SENSITIVE_KEYS = [
  "githubToken",
  "gitlabToken",
  "geminiApiKey",
  "claudeApiKey",
  "openaiApiKey",
] as const satisfies ReadonlyArray<keyof AppConfig>;

type SensitiveKey = (typeof SENSITIVE_KEYS)[number];
type SensitiveConfig = Pick<AppConfig, SensitiveKey>;
type PublicConfig = Omit<AppConfig, SensitiveKey>;

const DEFAULT_CONFIG: AppConfig = {
  githubToken: "",
  gitlabToken: "",
  gitlabBaseUrl: "",
  lastDetectedGitlabBaseUrl: "",
  geminiApiKey: "",
  claudeApiKey: "",
  openaiApiKey: "",
  defaultModel: "gpt-5-mini",
  defaultPlatform: "github",
  defaultProject: "",
  reviewDataConsentAccepted: false,
};

export class SecurityManager {
  private static instance: SecurityManager;

  static getInstance(): SecurityManager {
    if (!SecurityManager.instance) {
      SecurityManager.instance = new SecurityManager();
    }
    return SecurityManager.instance;
  }

  private constructor() {}

  private splitConfig(patch: PartialAppConfig): {
    publicPatch: Partial<PublicConfig>;
    secretPatch: Partial<SensitiveConfig>;
  } {
    const publicPatch: Record<string, unknown> = {};
    const secretPatch: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(patch) as Array<
      [keyof AppConfig, AppConfig[keyof AppConfig]]
    >) {
      if (SENSITIVE_KEYS.includes(key as SensitiveKey)) {
        secretPatch[key] = value;
      } else {
        publicPatch[key] = value;
      }
    }

    return {
      publicPatch: publicPatch as Partial<PublicConfig>,
      secretPatch: secretPatch as Partial<SensitiveConfig>,
    };
  }

  /** 读取完整配置 */
  async getConfig(): Promise<AppConfig> {
    const [publicConfig, secretConfig] = await Promise.all([
      localStorage.get<Partial<PublicConfig>>(PUBLIC_CONFIG_KEY),
      sessionStorage.get<Partial<SensitiveConfig>>(SECRET_CONFIG_KEY),
    ]);

    return {
      ...DEFAULT_CONFIG,
      ...(publicConfig ?? {}),
      ...(secretConfig ?? {}),
    };
  }

  /** 更新部分配置 */
  async updateConfig(patch: PartialAppConfig): Promise<void> {
    const current = await this.getConfig();
    const updated = { ...current, ...patch };
    const { publicPatch, secretPatch } = this.splitConfig(updated);

    await Promise.all([
      localStorage.set(PUBLIC_CONFIG_KEY, publicPatch),
      sessionStorage.set(SECRET_CONFIG_KEY, secretPatch),
    ]);
  }

  /** 读取单个配置项 */
  async get<K extends keyof AppConfig>(key: K): Promise<AppConfig[K]> {
    const config = await this.getConfig();
    return config[key];
  }

  /**
   * 🔴 一键抹除所有敏感数据
   * 清空 local/session 中的扩展配置
   */
  async nukeSensitiveData(): Promise<void> {
    await Promise.all([
      localStorage.remove(PUBLIC_CONFIG_KEY),
      sessionStorage.remove(SECRET_CONFIG_KEY),
    ]);
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
