// @ts-check
/** 只抽取 Agent 工作事件白名单，不读取或保存 transcript 与工具内容。 */
import { createHash, randomUUID } from 'node:crypto'
import { getBinding, readPairing, requestDesktop } from '../lib/bridge-client.js'

/**
 * Codex 会把一份 JSON 写入 stdin；异步 Hook 的管道不保证立刻发送 EOF。
 * 读到一份完整 JSON 后马上返回，避免一直等 EOF 导致命令超时而没有发出事件。
 */
async function readInput() {
  let raw = ''
  for await (const chunk of process.stdin) {
    raw += chunk
    if (Buffer.byteLength(raw) > 64 * 1024) return null
    const text = raw.trim()
    if (text === '') continue
    try { return JSON.parse(text) } catch {
      // JSON 可能被拆成多个数据块，继续读取；收到 EOF 时再判定为无效输入。
    }
  }
  const text = raw.trim()
  if (text === '') return null
  try { return JSON.parse(text) } catch { return null }
}

try {
  const input = await readInput()
  if (input === null || typeof input !== 'object') process.exit(0)
  const eventName = input.hook_event_name
  const event = eventName === 'UserPromptSubmit' ? 'start'
    : eventName === 'PreToolUse' ? 'working'
      : eventName === 'PermissionRequest' ? 'waiting'
      : eventName === 'PostToolUse' ? (input.tool_response?.isError === true ? 'error' : 'tool')
        : eventName === 'Stop' ? 'done'
          : eventName === 'Interrupt' ? 'interrupt'
            : null
  if (event === null) process.exit(0)
  const sessionId = typeof input.session_id === 'string' ? input.session_id : 'session'
  const turnId = typeof input.turn_id === 'string' ? input.turn_id : randomUUID()
  const invocationId = eventName === 'UserPromptSubmit' ? 'UserPromptSubmit'
    : eventName === 'PermissionRequest' ? (typeof input.tool_name === 'string' ? input.tool_name : 'PermissionRequest')
    : eventName === 'Stop' ? 'Stop'
      : eventName === 'Interrupt' ? 'Interrupt'
        : typeof input.tool_use_id === 'string' ? input.tool_use_id : randomUUID()
  const eventId = createHash('sha256').update(`${sessionId}:${turnId}:${eventName}:${invocationId}`).digest('hex')
  const pigId = getBinding()
  if (pigId === null) process.exit(0)
  readPairing()
  const success = eventName !== 'Interrupt' && eventName !== 'PermissionRequest' && input.tool_response?.isError !== true
  // 异步 Hook 会与界面共用桌面桥；给繁忙的 Windows Electron 留出写入时间，
  // 同时保持在 hooks.json 的两秒命令上限内。
  await requestDesktop('event', { pigId, event, eventId, success }, 1500)
} catch {
  // 桌面桥断开或数据无效都不能阻断 Agent 的原任务。
}
