/**
 * background.ts - Plasmo Service Worker / 扩展后端核心
 * 
 * 核心职责：
 * 1. 代理转发：作为 Side Panel 和 Git 平台/LLM 之间的中转站。通过 chrome.runtime.Port 实现跨进程长连接。
 * 2. 状态管理：监听并管理审查任务的生命周期（获取 Diff -> 智能分片 -> 调用 LLM -> 实时回传结果）。
 * 3. 稳定性保证：在 Service Worker 环境中处理复杂的流式数据交互，并确保连接断开时及时释放资源。
 */

import type { ReviewRequest, StreamMessage } from "~types"
import { DiffEngine } from "~core/diff-engine"
import { LLMClient } from "~core/llm"

export {}

/**
 * ── 1. 扩展启动与 UI 初始化 ──
 * 当扩展安装或更新时，设置侧边栏行为。
 */
chrome.runtime.onInstalled.addListener(() => {
  // 设置点击扩展图标时自动打开侧边栏
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

// 兼容逻辑：处理某些 Chrome 版本中 sidePanel 行为不一致的问题
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id })
  }
})

/**
 * ── 2. 跨进程长连接监听 (Port) ──
 * Side Panel 打开后会通过 AI_REVIEW_PORT 与此后台建立连接。
 * 使用 Port 的好处：支持双向实时消息，且当侧边栏关闭时，连接会自动断开。
 */
const REVIEW_PORT_NAME = "AI_REVIEW_PORT"

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== REVIEW_PORT_NAME) return

  // 监听来自侧边栏的审查启动请求
  port.onMessage.addListener(async (request: ReviewRequest) => {
    await handleReviewRequest(port, request)
  })

  port.onDisconnect.addListener(() => {
    // 当侧边栏关闭时，此处会被触发。
    // 如果后台有耗时操作仍在进行，可以通过监听此状态来提前终止。
  })
})

/**
 * ── 3. 业务逻辑核心：处理代码审查请求 ──
 * 
 * @param port 当前通信端口
 * @param request 包含 Git 配置和模型参数的请求体
 */
async function handleReviewRequest(
  port: chrome.runtime.Port,
  request: ReviewRequest
): Promise<void> {
  // 封装辅助发送函数，带错误处理以防端口中途关闭
  const send = (msg: StreamMessage) => {
    try {
      port.postMessage(msg)
    } catch {
      // 说明侧边栏已关闭，后台处理可以静默退出
    }
  }

  try {
    // ── 阶段 1：拉取并解析 Diff ──
    send({
      type: "REVIEW_PROGRESS",
      payload: {
        progress: {
          stage: "fetching_diff",
          message: `⏳ 正在从 ${request.gitConfig.platform} 获取 Diff...`
        }
      }
    })

    const engine = new DiffEngine(request.gitConfig)
    const diffPayload = await engine.fetchDiff(
      request.baseCommit,
      request.headCommit
    )

    // ── 阶段 2：智能分片 ──
    send({
      type: "REVIEW_PROGRESS",
      payload: {
        progress: {
          stage: "chunking",
          message: `✅ 已获取 ${diffPayload.files.length} 个文件，约 ${diffPayload.estimatedTokens.toLocaleString()} tokens`
        }
      }
    })

    // ── 阶段 3：调用 LLM 深度审查 ──
    const llm = new LLMClient(
      request.modelId,
      request.geminiApiKey,
      request.claudeApiKey
    )

    await llm.review(
      diffPayload,
      // onDelta：当 LLM 有新字符产出时实时推送到 UI
      (delta) => {
        send({ type: "STREAM_DELTA", payload: { delta } })
      },
      // onProgress：任务进展示，如“正在处理第 N 批摘要...”
      (message) => {
        send({
          type: "REVIEW_PROGRESS",
          payload: {
            progress: { stage: "reviewing_chunk", message }
          }
        })
      }
    )

    // ── 最终阶段：完成 ──
    send({
      type: "STREAM_DONE",
      payload: {
        progress: { stage: "done", message: "✅ 审查完成" }
      }
    })
  } catch (err: unknown) {
    // 统一错误处理，确保前端能收到异常通知
    const message =
      err instanceof Error ? err.message : "未知错误，请检查控制台"

    send({
      type: "STREAM_ERROR",
      payload: { error: message }
    })
  }
}

