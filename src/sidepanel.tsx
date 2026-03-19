/**
 * sidepanel.tsx - 侧边栏主界面组件
 *
 * 核心逻辑：
 * 1. 响应式表单：管理 Git 平台、Model 选择及分支 Hash 输入。
 * 2. 跨进程通信：通过 chrome.runtime.Port 与 background.ts 建立长连接，实现流式数据接收。
 * 3. 高性能渲染：
 *    - 使用 marked + DOMPurify 代替 react-markdown。
 *    - 原因：react-markdown 在 Plasmo 环境的 esbuild 打包下容易出现 vfile 路径解析错误和 hast 节点 null 属性崩溃问题。
 *    - 方案：通过 useMemo 钩子预处理 Markdown，保证流式输出时的渲染稳定性与安全性。
 * 4. 辅助功能：自动滚动探底、一键复制审查报告、API 配置监听同步。
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { securityManager } from "~core/storage";
import type { ModelId, ReviewProgress, StreamMessage } from "~types";
import { MODEL_CONFIGS } from "~types";
import "~styles/globals.css";
import {
  GitBranch,
  Play,
  Square,
  Settings,
  Trash2,
  ChevronDown,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import clsx from "clsx";

const PORT_NAME = "AI_REVIEW_PORT";

type ReviewStatus = "idle" | "loading" | "streaming" | "done" | "error";

type RepoDetection = {
  platform: "github" | "gitlab";
  projectId: string;
};

// 配置 marked：开启 GitHub 风格 (GFM) 并支持回车换行
marked.setOptions({ gfm: true, breaks: true });

function detectRepoFromUrl(rawUrl: string): RepoDetection | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const host = url.hostname.toLowerCase();
  const githubMarkers = new Set([
    "pull",
    "pulls",
    "compare",
    "commit",
    "commits",
    "tree",
    "blob",
    "issues",
    "actions",
    "releases",
    "settings",
  ]);
  const gitlabMarkers = new Set([
    "-",
    "commit",
    "commits",
    "compare",
    "merge_requests",
    "merge-request",
    "merge_requests",
    "blob",
    "tree",
    "tags",
    "branches",
    "pipelines",
  ]);

  if (host === "github.com" || host.endsWith(".github.com")) {
    return {
      platform: "github",
      projectId: `${segments[0]}/${segments[1]}`,
    };
  }

  const markerIndex = segments.findIndex((segment) =>
    gitlabMarkers.has(segment),
  );
  if (markerIndex >= 2) {
    // GitLab 项目可能带多级 group/subgroup；遇到 commits、compare、-/ 等标记时，
    // 取标记前面的所有路径段作为 projectId。
    return {
      platform: "gitlab",
      projectId: segments.slice(0, markerIndex).join("/"),
    };
  }

  const githubMarkerIndex = segments.findIndex((segment) =>
    githubMarkers.has(segment),
  );
  if (githubMarkerIndex === 2) {
    return {
      platform: "github",
      projectId: `${segments[0]}/${segments[1]}`,
    };
  }

  return null;
}

export default function SidePanel() {
  // ── 1. 表单状态管理 ──
  const [baseCommit, setBaseCommit] = useState("");
  const [headCommit, setHeadCommit] = useState("");
  const [platform, setPlatform] = useState<"github" | "gitlab">("github");
  const [projectId, setProjectId] = useState("");
  const [modelId, setModelId] = useState<ModelId>("gpt-5-mini");

  // ── 2. 审查业务状态 ──
  const [status, setStatus] = useState<ReviewStatus>("idle");
  const [content, setContent] = useState(""); // 累积的 LLM 输出文本 (Markdown)
  const [progress, setProgress] = useState<ReviewProgress | null>(null); // 后端处理进度
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false); // 复制按钮反馈状态

  // ── 3. 引用与生命周期管理 ──
  const portRef = useRef<chrome.runtime.Port | null>(null); // 保存持久化连接
  const contentRef = useRef(""); // 用于在异步监听器中安全累积内容，避免闭包捕获旧 state
  const bottomRef = useRef<HTMLDivElement>(null); // 用于自动滚动

  /**
   * 渲染核心：将 Markdown 文本实时转换为安全 HTML
   * 使用 useMemo 优化性能，仅在 content 变更时重新解析
   */
  const htmlContent = useMemo(() => {
    if (!content) return "";
    try {
      const raw = marked.parse(content) as string;
      return DOMPurify.sanitize(raw); // 必须进行 XSS 过滤
    } catch (e) {
      console.error("Markdown 解析失败", e);
      return content; // 降级处理
    }
  }, [content]);

  // 初始化：从本地安全存储加载用户配置的默认值
  useEffect(() => {
    const loadConfig = async () => {
      const cfg = await securityManager.getConfig();
      setPlatform(cfg.defaultPlatform);
      setProjectId(cfg.defaultProject);
      setModelId(cfg.defaultModel);

      try {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        // 打开侧边栏时优先读取当前仓库页面 URL，并覆盖默认项目配置。
        const detected = activeTab?.url
          ? detectRepoFromUrl(activeTab.url)
          : null;

        if (detected) {
          setPlatform(detected.platform);
          setProjectId(detected.projectId);
        }
      } catch (error) {
        console.warn("读取当前标签页 URL 失败", error);
      }
    };

    void loadConfig();

    // 监听 Options 页面或其他地方对配置的修改，实时同步 UI
    const listener = (changes: {
      [key: string]: chrome.storage.StorageChange;
    }) => {
      if (changes["app_config"]) {
        loadConfig();
      }
    };

    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  // 交互逻辑：流式输出时自动滚动到底部，提升阅读体验
  useEffect(() => {
    if (status === "streaming") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [content, status]);

  /**
   * 停止当前进行的审查任务
   * 断开 Port 连接会导致 background.ts 中的流式处理被自动终止
   */
  const stopReview = useCallback(() => {
    portRef.current?.disconnect();
    portRef.current = null;
    setProgress(null);
    setStatus((prev) => (prev === "streaming" ? "done" : "idle"));
  }, []);

  /**
   * 发起代码审查主函数
   */
  const startReview = useCallback(async () => {
    // 参数自检
    if (!baseCommit.trim() || !headCommit.trim() || !projectId.trim()) {
      setError("请填写基本信息以开始审查");
      return;
    }

    // 配置校验
    const cfg = await securityManager.getConfig();
    const { valid, missing } = await securityManager.validateConfig(platform);
    if (!valid) {
      setError(`配置不完整，缺少：${missing.join(" & ")}`);
      return;
    }

    const provider = MODEL_CONFIGS[modelId].provider;
    if (provider === "gemini" && !cfg.geminiApiKey) {
      setError("当前模型需要 Gemini API Key");
      return;
    }
    if (provider === "claude" && !cfg.claudeApiKey) {
      setError("当前模型需要 Claude API Key");
      return;
    }
    if (provider === "openai" && !cfg.openaiApiKey) {
      setError("当前模型需要 OpenAI API Key");
      return;
    }

    // 状态重置
    setError("");
    setContent("");
    contentRef.current = "";
    setStatus("loading");
    setProgress(null);

    // ── 建立 Port 长连接 ──
    const port = chrome.runtime.connect({ name: PORT_NAME });
    portRef.current = port;

    // 监听来自 background 的实时消息
    port.onMessage.addListener((msg: StreamMessage) => {
      switch (msg.type) {
        case "REVIEW_PROGRESS": // 进度更新（如：拉取 Diff、分片中...）
          setStatus("loading");
          setProgress(msg.payload?.progress ?? null);
          break;

        case "STREAM_DELTA": {
          // 流式文本片段
          const delta = msg.payload?.delta ?? "";
          contentRef.current += delta;
          setContent(contentRef.current);
          setStatus("streaming");
          break;
        }

        case "STREAM_DONE": // 生成结束
          setStatus("done");
          setProgress(null);
          portRef.current = null;
          break;

        case "STREAM_ERROR": // 处理异常
          setError(msg.payload?.error ?? "未知错误");
          setStatus("error");
          setProgress(null);
          portRef.current = null;
          break;
      }
    });

    // 处理连接意外中断（如用户合上盖子或 Service Worker 重启）
    port.onDisconnect.addListener(() => {
      setStatus((prev) =>
        prev === "done" || prev === "error" ? prev : "idle",
      );
      portRef.current = null;
    });

    // 发送业务请求指令
    port.postMessage({
      baseCommit: baseCommit.trim(),
      headCommit: headCommit.trim(),
      gitConfig: {
        platform,
        token: platform === "github" ? cfg.githubToken : cfg.gitlabToken,
        projectId: projectId.trim(),
        gitlabBaseUrl: cfg.gitlabBaseUrl,
      },
      modelId,
      geminiApiKey: cfg.geminiApiKey,
      claudeApiKey: cfg.claudeApiKey,
      openaiApiKey: cfg.openaiApiKey,
    });
  }, [baseCommit, headCommit, projectId, platform, modelId, status]);

  const openOptions = () => chrome.runtime.openOptionsPage();

  /**
   * 复制报告到剪切板逻辑
   */
  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // 2秒后恢复图标
    });
  }, [content]);

  const isRunning = status === "loading" || status === "streaming";

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden selection:bg-primary/30">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border/50 glass-panel z-10">
        <div className="flex items-center gap-2.5 group translate-y-[-1px] min-w-0">
          <div className="w-8 h-8 rounded-lg btn-gradient flex items-center justify-center animate-glow flex-shrink-0">
            <GitBranch className="w-4 h-4 text-white group-hover:rotate-12 transition-transform" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-[14px] tracking-tight leading-none bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent truncate">
              AI Git Reviewer
            </span>
            <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mt-1">
              Experimental v0.1
            </span>
          </div>
        </div>
        <button
          onClick={openOptions}
          className="p-2 rounded-lg hover:bg-white/5 transition-all text-muted-foreground hover:text-white"
          title="配置中心"
        >
          <Settings className="w-4 h-4" />
        </button>
      </header>

      {/* ── 配置与交互区域 ── */}
      <div className="px-4 py-4 space-y-3.5 bg-gradient-to-b from-card/30 to-transparent flex-shrink-0">
        <div className="grid grid-cols-2 gap-3">
          {/* 平台选择 */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground ml-1">
              Git 平台
            </label>
            <div className="relative group">
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as any)}
                disabled={isRunning}
                className="w-full appearance-none input-field h-10 cursor-pointer pr-8"
              >
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none group-hover:text-primary/60 transition-colors" />
            </div>
          </div>
          {/* 模型选择 */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground ml-1">
              核心模型
            </label>
            <div className="relative group">
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value as ModelId)}
                disabled={isRunning}
                className="w-full appearance-none input-field h-10 cursor-pointer pr-8 overflow-hidden text-ellipsis"
              >
                {Object.keys(MODEL_CONFIGS).map((id) => (
                  <option key={id} value={id}>
                    {MODEL_CONFIGS[id as ModelId].modelName}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none group-hover:text-primary/60 transition-colors" />
            </div>
          </div>
        </div>

        {/* 项目 ID */}
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground ml-1">
            项目标识 (Project / Repo)
          </label>
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={isRunning}
            placeholder={
              platform === "github" ? "owner/repository" : "Project ID / Path"
            }
            className="w-full input-field h-10 font-mono tracking-tight"
          />
        </div>

        {/* Commit Hash 范围 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground ml-1">
              起始 HASH
            </label>
            <input
              type="text"
              value={baseCommit}
              onChange={(e) => setBaseCommit(e.target.value)}
              disabled={isRunning}
              placeholder="Base SHA"
              className="w-full input-field h-10 font-mono placeholder:font-sans"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground ml-1">
              结束 HASH
            </label>
            <input
              type="text"
              value={headCommit}
              onChange={(e) => setHeadCommit(e.target.value)}
              disabled={isRunning}
              placeholder="Head SHA"
              className="w-full input-field h-10 font-mono placeholder:font-sans"
            />
          </div>
        </div>

        {/* 底部按钮组 */}
        <div className="flex gap-2 pt-0.5">
          <button
            onClick={isRunning ? stopReview : startReview}
            className={clsx(
              "flex-1 btn-gradient text-white rounded-xl h-10.5 text-sm font-bold flex items-center justify-center gap-2",
              isRunning && "after:opacity-10 shadow-primary/30",
            )}
          >
            {isRunning ? (
              <>
                <div className="w-2 h-2 bg-white rounded-sm animate-pulse" />
                停止任务
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white translate-x-[1px]" />
                深度代码审查
              </>
            )}
          </button>

          {/* 复制按钮 */}
          {content && (
            <button
              onClick={handleCopy}
              className="px-3 bg-white/5 border border-white/5 rounded-xl text-muted-foreground hover:text-white hover:bg-white/10 transition-all active:scale-95 disabled:opacity-50"
              title="复制结果"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          )}

          {/* 重置按钮 */}
          {(status === "done" || status === "error") && (
            <button
              onClick={() => {
                setContent("");
                contentRef.current = "";
                setStatus("idle");
                setError("");
                setProgress(null);
                setCopied(false);
              }}
              className="px-3 bg-white/5 border border-white/5 rounded-xl text-muted-foreground hover:text-white hover:bg-white/10 transition-all active:scale-95"
              title="重置"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── 实时进度条 ── */}
      {(status === "loading" || progress) && (
        <div className="mx-4 mb-3 p-3 rounded-xl bg-primary/5 border border-primary/20 flex items-center gap-3 animate-fade-in animate-float shadow-inner shadow-primary/5">
          <div className="relative">
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
            <div className="absolute inset-0 bg-primary/20 blur-md rounded-full animate-pulse" />
          </div>
          <span className="text-xs font-medium text-primary/90 tracking-wide">
            {progress?.message ?? "初始化算力引擎..."}
          </span>
        </div>
      )}

      {/* ── ERROR 区域 ── */}
      {error && (
        <div className="mx-4 mb-3 p-3.5 bg-destructive/10 border border-destructive/20 rounded-xl flex items-start gap-3 animate-fade-in">
          <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-bold text-destructive uppercase tracking-widest">
              ERROR
            </span>
            <span className="text-[13px] text-destructive/80 leading-snug font-medium">
              {error}
            </span>
          </div>
        </div>
      )}

      {/* ── 主渲染区域 (Markdown View) ── */}
      <div className="flex-1 overflow-y-auto px-4 py-2 scroll-smooth">
        {/* 空状态看板 */}
        {status === "idle" && !content && (
          <div className="h-full flex flex-col items-center justify-center text-center pb-20 animate-fade-in">
            <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/5 flex items-center justify-center mb-6 shadow-2xl animate-float">
              <GitBranch className="w-10 h-10 text-white/20" />
            </div>
            <div className="max-w-[200px] space-y-2">
              <p className="text-sm font-bold text-foreground tracking-tight">
                准备就绪
              </p>
              <p className="text-xs text-muted-foreground/50 leading-relaxed font-medium">
                配置 API 密钥并输入 Commit 哈希，开启 AI 辅助的代码质量保障之旅
              </p>
            </div>
          </div>
        )}

        {/* Markdown 内容渲染 */}
        {content && (
          <div
            className={clsx(
              "markdown-body markdown-wide animate-fade-in",
              status === "streaming" && "streaming-cursor",
            )}
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        )}

        {/* 任务完成标记 */}
        {status === "done" && (
          <div className="flex flex-col items-center gap-3 mt-12 mb-8 animate-fade-in">
            <div className="w-1 h-8 bg-gradient-to-b from-primary/50 to-transparent rounded-full" />
            <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full border border-primary/20">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
              <span className="text-[11px] font-bold text-primary uppercase tracking-widest">
                Review Finalized
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} className="h-10" />
      </div>
    </div>
  );
}
