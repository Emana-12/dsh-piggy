// @ts-check
/** 只抽取 Codex 工作事件白名单，不读取或保存 transcript 与工具内容。 */
import { createHash, randomUUID } from 'node:crypto'
import { getBinding, readPairing, requestDesktop } from '../lib/bridge-client.js'

let raw = ''
for await (const chunk of process.stdin) {
  raw += chunk
  if (Buffer.byteLength(raw) > 64 * 1024) {
    process.exit(0)
  }
}

try {
  const input = JSON.parse(raw)
  const eventName = input.hook_event_name
  const event = eventName === 'Stop' ? 'turn'
    : eventName === 'PostToolUse' ? 'tool'
      : null
  if (event === null) process.exit(0)
  const sessionId = typeof input.session_id === 'string' ? input.session_id : 'session'
  const turnId = typeof input.turn_id === 'string' ? input.turn_id : randomUUID()
  const invocationId = eventName === 'Stop' ? 'Stop' : typeof input.tool_use_id === 'string' ? input.tool_use_id : randomUUID()
  const eventId = createHash('sha256').update(`${sessionId}:${turnId}:${invocationId}`).digest('hex')
  const pigId = getBinding()
  if (pigId === null) process.exit(0)
  readPairing()
  const success = eventName === 'Stop' || input.tool_response?.isError !== true
  await requestDesktop('event', { pigId, event, eventId, success }, 700)
} catch {
  // 桌面桥断开或数据无效都不能阻断 Codex 的原任务。
}
