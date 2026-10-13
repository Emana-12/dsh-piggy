// 目标 AI：把本文件改成目标 CLI 的 Hook 入口后再安装。
// 不要读取 transcript、提示词、源码、命令正文或工具参数。
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requestDesktop } from './bridge-client.mjs'

let raw = ''
for await (const chunk of process.stdin) raw += chunk

try {
  const input = JSON.parse(raw)
  // TODO：替换成目标 CLI 的真实事件字段和稳定 ID 字段。
  const eventName = input.event_name
  const event = eventName === 'turn_end' ? 'turn' : eventName === 'tool_end' ? 'tool' : null
  if (event === null) process.exit(0)
  const sessionId = typeof input.session_id === 'string' ? input.session_id : 'session'
  const turnId = typeof input.turn_id === 'string' ? input.turn_id : randomUUID()
  const invocationId = typeof input.tool_use_id === 'string' ? input.tool_use_id : event
  const eventId = createHash('sha256').update(`${sessionId}:${turnId}:${invocationId}`).digest('hex')
  const binding = JSON.parse(readFileSync(join(process.env.CODEX_HOME || '', 'dsh-piggy-binding.json'), 'utf8'))
  const success = input.error !== true
  await requestDesktop('event', { pigId: binding.pigId, event, eventId, success })
} catch {
  // 记录失败不能阻断目标 CLI 的原任务。
}
