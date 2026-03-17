/**
 * diff-engine.ts - Diff 抓取与预处理引擎
 * 
 * 核心职责：
 * 1. Git 平台接入：统一 GitHub 和 GitLab 的 Diff 获取逻辑（处理分页与认证）。
 * 2. Token 估算：基于字符计数的启发式算法，预估 Diff 占用的模型上下文。
 * 3. 智能分片 (DiffBuffer)：核心算法逻辑，确保超大型变更能被模型消化。
 */

import { Octokit } from "@octokit/rest"
import type { DiffChunk, DiffFile, DiffPayload, GitConfig, ModelId } from "~types"
import { MODEL_CONFIGS } from "~types"

/**
 * Token 估算函数（近似 tiktoken cl100k 编码）
 * 
 * 为什么用启发式算法：
 * 在 Service Worker 环境中直接运行完整的 tiktoken (WASM) 比较笨重。
 * 对于代码 Diff，字符数 / 3.5 ~ 4 是一个非常可靠的预估，能够有效防止模型 Context Window 溢出。
 */
function estimateTokens(text: string): number {
  try {
    return Math.ceil(text.length / 3.5)
  } catch {
    return Math.ceil(text.length / 4)
  }
}

/**
 * DiffBuffer：Token 感知的分片管理器
 * 
 * 当一次 commit 涉及几百个文件时，LLM 无法一次完整处理。
 * 该类负责将庞大的 DiffPayload 拆解为多个安全的 DiffChunk。
 */
export class DiffBuffer {
  private modelId: ModelId
  /** 可用于输入的最大 token 数（考虑了上下文窗口、输出预留和系统提示 Buffer） */
  private maxInputTokens: number

  constructor(modelId: ModelId) {
    this.modelId = modelId
    const cfg = MODEL_CONFIGS[modelId]
    // 策略：预留 20% 的安全 Buffer，并扣除预期的输出 Token 和固定提示词 Token
    this.maxInputTokens =
      Math.floor(cfg.contextWindowTokens * 0.8) - cfg.maxOutputTokens - 2048
  }

  /**
   * 将 DiffPayload 拆分为若干 DiffChunk。
   * 
   * 分片策略：
   * 1. 优先按【文件粒度】打包：尽量把完整文件放在一个批次里，保持逻辑连贯性。
   * 2. 降级为【Hunk 粒度】：如果单个文件的 Diff 已经超过了整个上下文限制，
   *    则根据 Git 的 "@@" 标记将该文件拆解成多个分片块。
   */
  chunk(payload: DiffPayload): DiffChunk[] {
    const chunks: DiffChunk[] = []
    let currentFiles: DiffFile[] = []
    let currentTokens = 0

    for (const file of payload.files) {
      const fileTokens = estimateTokens(file.patch ?? "")

      if (fileTokens > this.maxInputTokens) {
        // 单个文件已经大到离谱 → 强制进入 Hunk 拆分模式
        if (currentFiles.length > 0) {
          chunks.push(this.makeChunk(currentFiles, currentTokens))
          currentFiles = []
          currentTokens = 0
        }
        const hunkChunks = this.splitByHunk(file)
        chunks.push(...hunkChunks)
        continue
      }

      if (currentTokens + fileTokens > this.maxInputTokens) {
        // 当前批次已攒满 -> 提交并开启新批次
        chunks.push(this.makeChunk(currentFiles, currentTokens))
        currentFiles = [file]
        currentTokens = fileTokens
      } else {
        currentFiles.push(file)
        currentTokens += fileTokens
      }
    }

    // 最后一批处理
    if (currentFiles.length > 0) {
      chunks.push(this.makeChunk(currentFiles, currentTokens))
    }

    // 标注索引和总量，方便进度展示
    return chunks.map((c, i) => ({ ...c, index: i, total: chunks.length }))
  }

  private makeChunk(files: DiffFile[], estimatedTokens: number): DiffChunk {
    return { index: 0, total: 0, files: [...files], estimatedTokens }
  }

  /** 
   * 单文件按 Hunk（@@ 标记）拆分 
   * 适用于处理那些被称为“巨型文件”的代码变更
   */
  private splitByHunk(file: DiffFile): DiffChunk[] {
    const chunks: DiffChunk[] = []
    const hunks = (file.patch ?? "").split(/(?=@@)/)
    let currentHunkPatch = ""
    let currentTokens = 0

    for (const hunk of hunks) {
      const hunkTokens = estimateTokens(hunk)
      if (currentTokens + hunkTokens > this.maxInputTokens && currentHunkPatch) {
        chunks.push(
          this.makeChunk(
            [{ ...file, patch: currentHunkPatch }],
            currentTokens
          )
        )
        currentHunkPatch = hunk
        currentTokens = hunkTokens
      } else {
        currentHunkPatch += hunk
        currentTokens += hunkTokens
      }
    }

    if (currentHunkPatch) {
      chunks.push(this.makeChunk([{ ...file, patch: currentHunkPatch }], currentTokens))
    }
    return chunks
  }

  /** 简单的检测函数：是否超出了当前模型的单次输入极限 */
  needsChunking(payload: DiffPayload): boolean {
    return payload.estimatedTokens > this.maxInputTokens
  }
}

/**
 * DiffEngine：多平台 Git 数据提取器
 */
export class DiffEngine {
  private config: GitConfig

  constructor(config: GitConfig) {
    this.config = config
  }

  /**
   * 抓取 Diff 的统一入口
   * @param baseCommit 起始哈希
   * @param headCommit 结束哈希
   */
  async fetchDiff(baseCommit: string, headCommit: string): Promise<DiffPayload> {
    this.validateCommitHash(baseCommit)
    this.validateCommitHash(headCommit)

    if (this.config.platform === "github") {
      return this.fetchGitHubDiff(baseCommit, headCommit)
    } else {
      return this.fetchGitLabDiff(baseCommit, headCommit)
    }
  }

  /** 校验 Commit 哈希格式，防止注入和非法请求 */
  private validateCommitHash(hash: string): void {
    if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
      throw new Error(`无效的 Commit Hash：${hash}`)
    }
  }

  // ── GitHub 实现细节 ──
  private async fetchGitHubDiff(base: string, head: string): Promise<DiffPayload> {
    const octokit = new Octokit({
      auth: this.config.token,
      request: { fetch: globalThis.fetch } // 必须为 Service Worker 注入 fetch
    })

    const [owner, repo] = this.config.projectId.split("/")
    if (!owner || !repo) {
      throw new Error('GitHub 项目格式应为 "owner/repo"')
    }

    let files: DiffFile[] = []
    let page = 1
    const perPage = 100

    // GitHub Commit Compare 接口的文件列表支持分页
    while (true) {
      const { data } = await octokit.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${base}...${head}`,
        per_page: perPage,
        page
      })

      const pageFiles: DiffFile[] = (data.files ?? []).map((f) => ({
        filename: f.filename,
        status: f.status as DiffFile["status"],
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? "",
        oldFilename: f.previous_filename
      }))

      files.push(...pageFiles)

      if (pageFiles.length < perPage) break
      page++

      // 设置硬性安全限制：单次审查最多支持 3000 个文件，防止僵尸任务
      if (files.length >= 3000) break
    }

    const totalAdditions = files.reduce((s, f) => s + f.additions, 0)
    const totalDeletions = files.reduce((s, f) => s + f.deletions, 0)
    const rawPatch = files.map((f) => f.patch).join("\n")

    return {
      baseCommit: base,
      headCommit: head,
      files,
      totalAdditions,
      totalDeletions,
      estimatedTokens: estimateTokens(rawPatch)
    }
  }

  // ── GitLab 实现细节 ──
  private async fetchGitLabDiff(base: string, head: string): Promise<DiffPayload> {
    const baseUrl = (this.config.gitlabBaseUrl ?? "https://gitlab.com").replace(/\/$/, "")
    const projectId = encodeURIComponent(this.config.projectId)
    const headers = {
      "PRIVATE-TOKEN": this.config.token,
      Accept: "application/json"
    }

    let files: DiffFile[] = []
    let page = 1
    const perPage = 100

    while (true) {
      const url =
        `${baseUrl}/api/v4/projects/${projectId}/repository/compare` +
        `?from=${base}&to=${head}&straight=false&per_page=${perPage}&page=${page}`

      const res = await this.fetchWithRetry(url, { headers })

      if (!res.ok) {
        const body = await res.text()
        if (res.status === 404) {
          throw new Error(`未找到对应的 Commit 或项目，请检查 Hash 和 Project ID`)
        }
        if (res.status === 401) {
          throw new Error(`GitLab Token 无效或权限不足`)
        }
        if (res.status === 429) {
          throw new Error(`GitLab API 速率限制，请稍后重试`)
        }
        throw new Error(`GitLab API 错误 ${res.status}: ${body}`)
      }

      const data = await res.json()
      const pageDiffs: DiffFile[] = (data.diffs ?? []).map((d: any) => ({
        filename: d.new_path,
        oldFilename: d.old_path !== d.new_path ? d.old_path : undefined,
        status: d.new_file ? "added" : d.deleted_file ? "removed" : d.renamed_file ? "renamed" : "modified",
        additions: 0, 
        deletions: 0,
        patch: d.diff ?? ""
      }))

      files.push(...pageDiffs)

      if (pageDiffs.length < perPage) break
      page++
      if (files.length >= 3000) break
    }

    const rawPatch = files.map((f) => f.patch).join("\n")
    return {
      baseCommit: base,
      headCommit: head,
      files,
      totalAdditions: 0,
      totalDeletions: 0,
      estimatedTokens: estimateTokens(rawPatch)
    }
  }

  /** 带指数退避的 fetch：优雅处理 API 频率限制 (429) */
  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    maxRetries = 3
  ): Promise<Response> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetch(url, init)
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? 5)
        // 指数加严等待：重试时间随次数增加而翻倍
        await new Promise((r) => setTimeout(r, retryAfter * 1000 * (attempt + 1)))
        continue
      }
      return res
    }
    throw new Error("超过 GitLab API 最大重试次数")
  }
}

