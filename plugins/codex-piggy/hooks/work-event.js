// @ts-check
/** 只抽取 Agent 工作事件白名单，不读取或保存 transcript 与工具内容。 */
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
  await requestDesktop('event', { pigId, event, eventId, success }, 700)
} catch {
  // 桌面桥断开或数据无效都不能阻断 Agent 的原任务。
}
