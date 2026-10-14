// 所有支持本地 Hook 的 Agent 都映射到这组宿主无关事件。
export const AGENT_EVENTS = Object.freeze(['start', 'working', 'waiting', 'done', 'error', 'interrupt'])

export function isAgentEvent(value) {
  return typeof value === 'string' && AGENT_EVENTS.includes(value)
}

/**
 * 生成跨重试稳定的事件 ID。调用方只能传入事件标识，不要传提示词或工具内容。
 */
export function eventIdFor(hash, { sessionId = 'session', turnId = 'turn', eventName, invocationId = 'event' }) {
  if (!isAgentEvent(eventName)) throw new Error(`不支持的 Agent 事件：${String(eventName)}`)
  return hash(`${sessionId}:${turnId}:${eventName}:${invocationId}`)
}
