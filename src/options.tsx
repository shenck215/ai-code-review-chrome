import { useEffect, useState } from "react";
import { securityManager, SecurityManager } from "~core/storage";
import type { AppConfig, ModelId } from "~types";
import { MODEL_CONFIGS } from "~types";
import "~styles/globals.css";
import {
  Key,
  Globe,
  Github,
  Trash2,
  Save,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Shield,
  Cpu,
  ShieldCheck,
  Loader2,
  Settings,
} from "lucide-react";
import clsx from "clsx";

export default function OptionsPage() {
  const [config, setConfig] = useState<Partial<AppConfig>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  // 状态反馈
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  useEffect(() => {
    securityManager.getConfig().then((cfg) => {
      setConfig({
        ...cfg,
        gitlabBaseUrl: cfg.gitlabBaseUrl || cfg.lastDetectedGitlabBaseUrl,
      });
    });
  }, []);

  const updateConfig = (key: keyof AppConfig, value: string) => {
    setConfig({ ...config, [key]: value });
  };

  const toggleVisibility = (key: string) => {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      await securityManager.updateConfig(config);
      setMessage({
        text: "配置已更新，敏感凭证仅保存在当前浏览器会话",
        type: "success",
      });
    } catch (err) {
      setMessage({ text: "保存失败，请检查填写内容", type: "error" });
    } finally {
      setIsSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleNuke = async () => {
    if (
      confirm(
        "警告：此操作将清空当前浏览器中的 API 密钥和本地配置。确定继续吗？",
      )
    ) {
      await securityManager.nukeSensitiveData();
      setConfig({});
      alert("当前浏览器中的扩展配置已清空。");
    }
  };

  const validateKey = (key: keyof AppConfig, value: string) => {
    if (!value) return true;
    if (key === "githubToken")
      return SecurityManager.validateKeyFormat(value, "github");
    if (key === "gitlabToken")
      return SecurityManager.validateKeyFormat(value, "gitlab");
    if (key === "geminiApiKey")
      return SecurityManager.validateKeyFormat(value, "gemini");
    if (key === "claudeApiKey")
      return SecurityManager.validateKeyFormat(value, "claude");
    if (key === "openaiApiKey")
      return SecurityManager.validateKeyFormat(value, "openai");
    return true;
  };

  return (
    <div className="min-h-screen bg-background text-foreground py-12 px-6 flex justify-center selection:bg-primary/30">
      <div className="w-full max-w-2xl space-y-10 animate-fade-in">
        {/* ── Header ── */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl btn-gradient flex items-center justify-center animate-glow mb-2">
            <Shield className="w-8 h-8 text-white animate-float" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
              控制中心
            </h1>
            <p className="text-muted-foreground text-sm mt-2 max-w-md mx-auto leading-relaxed">
              在此配置访问令牌与 AI 模型。敏感凭证仅保存在当前浏览器会话中；
              执行审查时，相关 Diff 会发送到你选择的 Git 平台与 AI 服务商 API。
            </p>
          </div>
        </div>

        {/* ── Git 平台配置 ── */}
        <section className="glass-panel rounded-3xl p-8 space-y-8 shadow-2xl">
          <div className="flex items-center gap-3 border-b border-border/50 pb-4">
            <div className="p-2 rounded-lg bg-primary/10">
              <Github className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-xl font-bold tracking-tight">Git 凭证</h2>
          </div>

          <div className="grid gap-8">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">
                  GitHub Personal Access Token
                </label>
                <div className="flex items-center gap-1.5 text-[10px] text-primary font-mono bg-primary/10 px-2 py-0.5 rounded-full">
                  <ShieldCheck className="w-3 h-3" />
                  SESSION ONLY
                </div>
              </div>
              <div className="relative group">
                <input
                  type={showKeys["github"] ? "text" : "password"}
                  value={config.githubToken ?? ""}
                  onChange={(e) => updateConfig("githubToken", e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxx"
                  className={clsx(
                    "w-full input-field h-12 pr-12 font-mono",
                    !validateKey("githubToken", config.githubToken ?? "") &&
                      "border-destructive/50",
                  )}
                />
                <button
                  onClick={() => toggleVisibility("github")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-white/5 text-muted-foreground transition-colors"
                >
                  {showKeys["github"] ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">
                  GitLab Token
                </label>
                <div className="relative group">
                  <input
                    type={showKeys["gitlab"] ? "text" : "password"}
                    value={config.gitlabToken ?? ""}
                    onChange={(e) =>
                      updateConfig("gitlabToken", e.target.value)
                    }
                    placeholder="glpat-xxxxxxxx"
                    className={clsx(
                      "w-full input-field h-12 pr-12 font-mono",
                      !validateKey("gitlabToken", config.gitlabToken ?? "") &&
                        "border-destructive/50",
                    )}
                  />
                  <button
                    onClick={() => toggleVisibility("gitlab")}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-white/5 text-muted-foreground transition-colors"
                  >
                    {showKeys["gitlab"] ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">
                  GitLab API 终点
                </label>
                <input
                  type="text"
                  value={config.gitlabBaseUrl ?? ""}
                  onChange={(e) =>
                    updateConfig("gitlabBaseUrl", e.target.value)
                  }
                  placeholder="留空自动识别"
                  className="w-full input-field h-12 font-mono tracking-tight"
                />
                <p className="text-xs leading-relaxed text-muted-foreground/80">
                  打开 GitLab 仓库页面时会优先使用当前页面域名；只有未识别到
                  GitLab 页面时，才会使用这里填写的地址，最后回退到
                  <span className="font-mono"> https://gitlab.com</span>。首次访问任意
                  GitLab 域名时，扩展会按该域名单独请求一次权限。
                </p>
                {!config.gitlabBaseUrl && config.lastDetectedGitlabBaseUrl && (
                  <p className="text-xs leading-relaxed text-emerald-300/90">
                    最近识别到的 GitLab 地址：
                    <span className="font-mono">
                      {" "}
                      {config.lastDetectedGitlabBaseUrl}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── AI 模型配置 ── */}
        <section className="glass-panel rounded-3xl p-8 space-y-8 shadow-2xl">
          <div className="flex items-center gap-3 border-b border-border/50 pb-4">
            <div className="p-2 rounded-lg bg-primary/10">
              <Cpu className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-xl font-bold tracking-tight">AI 智能体引擎</h2>
          </div>

          <div className="grid gap-8">
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">
                Gemini API Key
              </label>
              <div className="relative group">
                <input
                  type={showKeys["gemini"] ? "text" : "password"}
                  value={config.geminiApiKey ?? ""}
                  onChange={(e) => updateConfig("geminiApiKey", e.target.value)}
                  placeholder="AIzaSyXXXXXXXXXXXXXXXXXX"
                  className={clsx(
                    "w-full input-field h-12 pr-12 font-mono",
                    !validateKey("geminiApiKey", config.geminiApiKey ?? "") &&
                      "border-destructive/50",
                  )}
                />
                <button
                  onClick={() => toggleVisibility("gemini")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-white/5 text-muted-foreground transition-colors"
                >
                  {showKeys["gemini"] ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">
                Claude API Key
              </label>
              <div className="relative group">
                <input
                  type={showKeys["claude"] ? "text" : "password"}
                  value={config.claudeApiKey ?? ""}
                  onChange={(e) => updateConfig("claudeApiKey", e.target.value)}
                  placeholder="sk-ant-xxxxxxxx"
                  className={clsx(
                    "w-full input-field h-12 pr-12 font-mono",
                    !validateKey("claudeApiKey", config.claudeApiKey ?? "") &&
                      "border-destructive/50",
                  )}
                />
                <button
                  onClick={() => toggleVisibility("claude")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-white/5 text-muted-foreground transition-colors"
                >
                  {showKeys["claude"] ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">
                OpenAI API Key
              </label>
              <div className="relative group">
                <input
                  type={showKeys["openai"] ? "text" : "password"}
                  value={config.openaiApiKey ?? ""}
                  onChange={(e) => updateConfig("openaiApiKey", e.target.value)}
                  placeholder="sk-xxxxxxxx"
                  className={clsx(
                    "w-full input-field h-12 pr-12 font-mono",
                    !validateKey("openaiApiKey", config.openaiApiKey ?? "") &&
                      "border-destructive/50",
                  )}
                />
                <button
                  onClick={() => toggleVisibility("openai")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-white/5 text-muted-foreground transition-colors"
                >
                  {showKeys["openai"] ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── 默认偏好 ── */}
        <section className="glass-panel rounded-3xl p-8 space-y-8 shadow-2xl">
          <div className="flex items-center gap-3 border-b border-border/50 pb-4">
            <div className="p-2 rounded-lg bg-primary/10">
              <Globe className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-xl font-bold tracking-tight">默认偏好</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3 text-sm">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">
                默认 Git 平台
              </label>
              <select
                value={config.defaultPlatform ?? "github"}
                onChange={(e) =>
                  updateConfig("defaultPlatform", e.target.value)
                }
                className="w-full input-field h-12 appearance-none cursor-pointer"
              >
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
              </select>
            </div>
            <div className="space-y-3 text-sm">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">
                默认 AI 模型
              </label>
              <select
                value={config.defaultModel ?? "gemini-3.1-flash-lite-preview"}
                onChange={(e) => updateConfig("defaultModel", e.target.value)}
                className="w-full input-field h-12 appearance-none cursor-pointer"
              >
                {Object.keys(MODEL_CONFIGS).map((id) => (
                  <option key={id} value={id}>
                    {MODEL_CONFIGS[id as ModelId].modelName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* ── 操作区 ── */}
        <div className="flex flex-col sm:flex-row items-center gap-4 pt-6 pb-20">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full sm:w-auto px-10 h-14 btn-gradient text-white rounded-2xl font-bold flex items-center justify-center gap-3 text-lg disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Save className="w-5 h-5" />
            )}
            保存配置
          </button>

          <button
            onClick={handleNuke}
            className="w-full sm:w-auto px-6 h-14 bg-destructive/10 border border-destructive/20 hover:bg-destructive text-destructive hover:text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2 group"
          >
            <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform" />
            清空本地配置
          </button>

          {message && (
            <div
              className={clsx(
                "flex-1 flex items-center gap-2.5 px-6 h-14 rounded-2xl border animate-fade-in",
                message.type === "success"
                  ? "bg-primary/5 border-primary/20 text-primary"
                  : "bg-destructive/5 border-destructive/20 text-destructive",
              )}
            >
              {message.type === "success" ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
              <span className="text-sm font-bold tracking-tight">
                {message.text}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
