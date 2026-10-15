// @ts-check
/**
 * 桌面 Electron 主进程托管的 Codex 本机桥。所有读写都回到唯一的 store 实例。
 * @module dsh-piggy-desktop/codex-bridge
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { createServer } from 'node:net'

const PROTOCOL_VERSION = 1
const MAX_MESSAGE_BYTES = 1024 * 1024
// Agent Hook 的统一生命周期事件；旧版 Codex 事件保留兼容，便于平滑更新适配器。
const AGENT_EVENTS = new Set(['start', 'working', 'waiting', 'done', 'error', 'interrupt', 'turn', 'tool', 'toolError', 'prompt'])
const ACTIONS = new Set(['hatch', 'adopt', 'reset', 'feed', 'bathe', 'play', 'pet', 'reply', 'signIn', 'pomodoro', 'pomodoroAbandon', 'openGift', 'removeExtension', 'installExtension', 'ext', 'setExtension', 'chat', 'quiet', 'owner', 'catchphrase', 'motto', 'crown', 'name', 'work', 'study', 'interest', 'trip', 'fishCast', 'fishHook', 'fishResolve', 'fishKeep', 'fishFeed', 'fishSell', 'fishRod', 'fishAutomation', 'fishCollect', 'fishSpot', 'exchange', 'fishAuto', 'fishGive', 'fishSkip', 'skin', 'calloff', 'buy', 'use', 'doctor', 'sell', 'wear'])
const ACTION_FIELDS = Object.freeze({
  hatch: [], adopt: ['confirm'], reset: ['confirm'], feed: ['item'], bathe: ['item'], play: ['item'], pet: ['part'], reply: ['line', 'index'],
  signIn: [], pomodoro: ['minutes'], pomodoroAbandon: [], openGift: [], removeExtension: ['key', 'confirm'], installExtension: ['key', 'confirm'],
  ext: ['key', 'op', 'data'], setExtension: ['key', 'on'], chat: ['reason'], quiet: ['on'], owner: ['name'], catchphrase: ['text'], motto: ['text'],
  crown: ['form'], name: ['name'], work: ['job', 'short'], study: ['subject', 'stage'], interest: ['interest'], trip: ['trip'], fishCast: ['power', 'bait'],
  fishHook: [], fishResolve: ['success'], fishKeep: [], fishFeed: ['id'], fishSell: ['id'], fishRod: [], fishAutomation: ['kind'], fishCollect: [],
  fishSpot: ['spot'], exchange: ['key', 'direction', 'amount'], fishAuto: ['minutes', 'bait'], fishGive: ['fish'], fishSkip: [], skin: ['skin', 'confirm'],
  calloff: [], buy: ['item'], use: ['item'], doctor: [], sell: ['souvenir'], wear: ['item', 'on'],
})
const REQUIRED_FIELDS = Object.freeze({
  adopt: ['confirm'], reset: ['confirm'], feed: ['item'], bathe: ['item'], play: ['item'], pet: ['part'], reply: ['line', 'index'], pomodoro: ['minutes'],
  removeExtension: ['key', 'confirm'], installExtension: ['key', 'confirm'], ext: ['key', 'op'], setExtension: ['key', 'on'], owner: ['name'],
  catchphrase: ['text'], motto: ['text'], crown: ['form'], name: ['name'], work: ['job'], study: ['subject', 'stage'], interest: ['interest'],
  trip: ['trip'], fishCast: ['power', 'bait'], fishResolve: ['success'], fishFeed: ['id'], fishSell: ['id'], fishAutomation: ['kind'], fishSpot: ['spot'],
  exchange: ['key', 'direction', 'amount'], fishAuto: ['minutes', 'bait'], fishGive: ['fish'], skin: ['skin', 'confirm'], buy: ['item'], use: ['item'],
  sell: ['souvenir'], wear: ['item'],
})
const DANGEROUS_ACTIONS = new Set(['reset', 'adopt', 'removeExtension', 'installExtension', 'skin'])
const POMODORO_MINUTES = new Set([15, 25, 45])
const EXCHANGE_DIRECTIONS = new Set(['toGold', 'fromGold'])
const FISH_AUTO_MINUTES = new Set([30, 60, 120, 240])

/** 由桌面端和 Codex 插件共同计算当前用户的 IPC 地址。 */
export function codexBridgeEndpoint(platform = process.platform, uid = process.getuid?.(), username = userInfo().username) {
  if (platform === 'win32') {
    const suffix = createHash('sha256').update(username.toLowerCase()).digest('hex').slice(0, 20)
    return `\\\\.\\pipe\\dsh-piggy-${suffix}`
  }
  const suffix = createHash('sha256').update(typeof uid === 'number' ? String(uid) : homedir()).digest('hex').slice(0, 20)
  return join(tmpdir(), `dsh-piggy-${suffix}.sock`)
}

function isClosedPipeError(error) {
  return error?.code === 'EPIPE' || error?.code === 'ECONNRESET' || error?.code === 'ERR_STREAM_DESTROYED'
}

/**
 * 开启桌面版桥接端点。
 * @param {{ getStatus: () => Promise<object>, getStore: () => any, getExtensions?: () => Promise<object>, handleAction: (body: object) => Promise<object>, endpoint?: string, pairingFile?: string, onStateChange?: () => void, onRequest?: (method: string, outcome: string) => void }} options
 */
export function startCodexBridge(options) {
  const endpoint = options.endpoint ?? codexBridgeEndpoint()
  const pairingToken = randomBytes(32).toString('hex')
  const configuredSharedHome = process.env.DSH_PIGGY_HOME
  const configuredCodexHome = process.env.CODEX_HOME
  const codexHome = typeof configuredSharedHome === 'string' && configuredSharedHome.trim() !== ''
    ? configuredSharedHome
    : typeof configuredCodexHome === 'string' && configuredCodexHome.trim() !== '' ? configuredCodexHome : join(homedir(), '.codex')
  const pairingFile = options.pairingFile ?? join(codexHome, 'dsh-piggy-pairing.json')
  const seenEvents = new Map()
  const actionResults = new Map()
  const clients = new Set()
  let closed = false
  let writeQueue = Promise.resolve()
  let readyResolve
  let readyReject
  let readySettled = false
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })

  const server = createServer(socket => {
    clients.add(socket)
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', chunk => {
      buffer += chunk
      if (Buffer.byteLength(buffer, 'utf8') > MAX_MESSAGE_BYTES) { socket.destroy(); return }
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        void respond(socket, line).catch(error => send(socket, '', false, error instanceof Error ? error.message : String(error)))
      }
    })
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => clients.delete(socket))
  })
  async function respond(socket, line) {
    let request
    try {
      request = JSON.parse(line)
      if (request?.version !== PROTOCOL_VERSION || typeof request.id !== 'string' || typeof request.method !== 'string') throw new Error('请求格式无效')
      const supplied = typeof request.token === 'string' ? Buffer.from(request.token) : Buffer.alloc(0)
      const expected = Buffer.from(pairingToken)
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('配对凭据无效')
      logRequest(request.method, 'received')
      if (request.method === 'pair') return send(socket, request.id, true, { pigId: options.getStore()?.state?.pigId ?? null })
      if (!['status', 'extensions', 'action', 'event'].includes(request.method)) throw new Error('不支持的桌面桥方法')
      if (request.method === 'action' && (typeof request.operation !== 'string' || !ACTIONS.has(request.operation))) throw new Error('养成操作不在允许列表中')
      if (request.method === 'event' && (typeof request.event !== 'string' || !AGENT_EVENTS.has(request.event))) throw new Error('Agent 工作事件无效')
      const status = await options.getStatus()
      const currentPigId = typeof status.pigId === 'string' ? status.pigId : null
      const isEmptySaveRead = currentPigId === null && request.pigId === null && request.method === 'status'
      const isExtensionCatalogRead = request.method === 'extensions' && (currentPigId === null ? request.pigId === null : request.pigId === currentPigId)
      const isFirstHatch = currentPigId === null && request.pigId === null && request.method === 'action' && request.operation === 'hatch'
      if (!isEmptySaveRead && !isExtensionCatalogRead && !isFirstHatch && (currentPigId === null || request.pigId !== currentPigId)) throw new Error('桌面小猪绑定身份已变化，请重新配对')
      if (request.method === 'status') return send(socket, request.id, true, status)
      if (request.method === 'extensions') {
        const result = await (options.getExtensions?.() ?? Promise.resolve({ entries: [] }))
        logRequest(request.method, 'ok')
        return send(socket, request.id, true, result)
      }
      let result
      let wroteState = false
      if (request.method === 'status') result = status
      else if (request.method === 'action' || request.method === 'event') result = await serializeWrite(async () => {
        const current = await options.getStatus()
        const currentPigId = typeof current.pigId === 'string' ? current.pigId : null
        const isFirstHatch = currentPigId === null && request.pigId === null && request.method === 'action' && request.operation === 'hatch'
        if (!isFirstHatch && (currentPigId === null || request.pigId !== currentPigId)) throw new Error('桌面小猪绑定身份已变化，请重新配对')
        if (request.method === 'action') {
          const actionResult = await performAction(request)
          wroteState = actionResult?.ok !== false
          return actionResult
        }
        const eventResult = recordEvent(request)
        wroteState = eventResult?.ok === true && eventResult?.duplicate !== true
        return eventResult
      })
      else throw new Error('不支持的桌面桥方法')
      if (request.method === 'action' && wroteState) options.onStateChange?.()
      if (request.method === 'event' && wroteState) options.onStateChange?.()
      logRequest(request.method, 'ok')
      send(socket, request.id, true, result)
    } catch (error) {
      logRequest(typeof request?.method === 'string' ? request.method : 'invalid', 'error')
      send(socket, typeof request?.id === 'string' ? request.id : '', false, error instanceof Error ? error.message : String(error))
    }
  }

  async function performAction(request) {
    if (typeof request.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(request.requestId)) throw new Error('写操作缺少唯一 requestId')
    if (typeof request.operation !== 'string' || !ACTIONS.has(request.operation) || !isRecord(request.params)) throw new Error('养成操作不在允许列表中')
    validateAction(request.operation, request.params)
    if (DANGEROUS_ACTIONS.has(request.operation) && request.params.confirm !== '我确认') throw new Error('此操作会重置/覆盖存档、安装或删除扩展、替换皮肤，必须先取得用户明确确认，并设置 confirm="我确认"')
    if (request.operation === 'ext') {
      const store = options.getStore()
      const state = store?.state
      const enabled = state?.extensions?.[request.params.key] === true || state?.extData?.[request.params.key] !== undefined && state?.extensions?.[request.params.key] !== false
      if (!enabled) throw new Error('目标扩展未安装或已关闭，请先在桌面小猪中安装并启用扩展')
    }
    if (actionResults.has(request.requestId)) return actionResults.get(request.requestId)
      const result = await options.handleAction({ ...request.params, action: request.operation })
    remember(actionResults, request.requestId, result, 2048)
    return result
  }

  function serializeWrite(write) {
    const result = writeQueue.then(write, write)
    writeQueue = result.then(() => undefined, () => undefined)
    return result
  }

  function recordEvent(request) {
    if (typeof request.event !== 'string' || !AGENT_EVENTS.has(request.event) || typeof request.eventId !== 'string' || request.eventId.length > 256) throw new Error('Agent 工作事件无效')
    if (seenEvents.has(request.eventId)) return { ok: true, accepted: false, duplicate: true }
    const store = options.getStore()
    const record = typeof store?.recordAgentEvent === 'function' ? store.recordAgentEvent : store?.recordCodexEvent
    if (typeof record !== 'function') throw new Error('当前桌面游戏包不支持 Agent 工作事件，请更新游戏包')
    const result = record.call(store, request.event, request.eventId, request.success !== false)
    if (result.ok) remember(seenEvents, request.eventId, true, 8192)
    return result
  }

  function send(socket, id, ok, result) {
    if (socket.destroyed) return
    const message = ok ? { version: PROTOCOL_VERSION, id, ok, result } : { version: PROTOCOL_VERSION, id, ok, error: result }
    try { socket.write(`${JSON.stringify(message)}\n`) } catch (error) {
      if (!isClosedPipeError(error)) throw error
    }
  }

  function remember(map, key, value, limit) {
    map.set(key, value)
    if (map.size > limit) map.delete(map.keys().next().value)
  }

  function logRequest(method, outcome) {
    try { options.onRequest?.(method, outcome) } catch { /* 日志失败不能影响养成操作 */ }
  }

  if (process.platform !== 'win32' && existsSync(endpoint)) {
    const info = lstatSync(endpoint)
    if (!info.isSocket()) throw new Error(`拒绝替换非 socket 路径：${endpoint}`)
    unlinkSync(endpoint)
  }
  // Windows 命名管道不属于文件系统路径；桌面退出后旧凭据文件应删除。
  if (process.platform === 'win32' && existsSync(pairingFile) && !lstatSync(pairingFile).isFile()) throw new Error(`拒绝替换非文件配对路径：${pairingFile}`)
  if (process.platform !== 'win32' && existsSync(pairingFile) && !lstatSync(pairingFile).isFile()) throw new Error(`拒绝替换非文件配对路径：${pairingFile}`)
  server.listen(endpoint)
  server.on('listening', () => {
    try {
      if (process.platform !== 'win32') chmodSync(endpoint, 0o600)
      mkdirSync(dirname(pairingFile), { recursive: true, mode: 0o700 })
      const temp = `${pairingFile}.${randomBytes(8).toString('hex')}.tmp`
      writeFileSync(temp, `${JSON.stringify({ endpoint, pairingToken })}\n`, { mode: 0o600 })
      if (process.platform !== 'win32') chmodSync(temp, 0o600)
      renameSync(temp, pairingFile)
      readySettled = true
      readyResolve()
    } catch (error) {
      readySettled = true
      readyReject(error)
      server.close()
    }
  })
  server.on('error', error => {
    if (readySettled) return
    readySettled = true
    readyReject(error)
  })

  return {
    endpoint,
    ready,
    close() {
      if (closed) return
      closed = true
      for (const socket of clients) socket.destroy()
      clients.clear()
      server.close(() => {
        if (process.platform !== 'win32' && existsSync(endpoint) && lstatSync(endpoint).isSocket()) unlinkSync(endpoint)
        if (existsSync(pairingFile)) unlinkSync(pairingFile)
      })
    },
  }
}

// 新适配器使用宿主无关的名称；保留旧导出名供现有桌面入口调用。
export const startAgentBridge = startCodexBridge

function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }

function validateAction(action, params) {
  const allowed = ACTION_FIELDS[action]
  if (allowed === undefined || Object.keys(params).some(key => !allowed.includes(key))) throw new Error(`操作 ${action} 含不支持的参数`)
  for (const field of REQUIRED_FIELDS[action] ?? []) {
    if (!Object.prototype.hasOwnProperty.call(params, field)) throw new Error(`操作 ${action} 缺少必填参数 ${field}`)
  }
  for (const [key, value] of Object.entries(params)) {
    const numeric = ['line', 'index', 'minutes', 'power', 'amount'].includes(key)
    const boolean = ['short', 'success', 'on'].includes(key)
    const object = key === 'data'
    if (numeric && (!Number.isFinite(value) || value < 0)) throw new Error(`参数 ${key} 必须是非负数`)
    if (boolean && typeof value !== 'boolean') throw new Error(`参数 ${key} 必须是布尔值`)
    if (!numeric && !boolean && !object && typeof value !== 'string') throw new Error(`参数 ${key} 必须是文本`)
    if (typeof value === 'string' && value.length > 512) throw new Error(`参数 ${key} 超过长度限制`)
  }
  if (['dev', 'ageFromNow', 'timeScale', 'giveAll'].includes(action)) throw new Error('此调试操作不通过 Codex 桥开放')
  if (action === 'ext') {
    if (typeof params.key !== 'string' || !/^[a-z0-9-]{2,24}$/.test(params.key) || typeof params.op !== 'string' || params.op.length > 80) throw new Error('扩展标识或操作名无效')
    if (params.data !== undefined && !isSafeExtensionData(params.data)) throw new Error('扩展操作数据无效或过大')
  }
  if (['removeExtension', 'installExtension', 'setExtension'].includes(action) && (typeof params.key !== 'string' || !/^[a-z0-9-]{2,24}$/.test(params.key))) throw new Error('扩展标识无效')
  if (action === 'pomodoro' && !POMODORO_MINUTES.has(params.minutes)) throw new Error('番茄钟时长只能选择 15、25 或 45 分钟')
  if (action === 'fishCast' && (params.power < 0 || params.power > 1)) throw new Error('钓鱼力度必须在 0 到 1 之间')
  if (action === 'fishAuto' && !FISH_AUTO_MINUTES.has(params.minutes)) throw new Error('自动钓鱼时长不受支持')
  if (action === 'exchange' && (!EXCHANGE_DIRECTIONS.has(params.direction) || !Number.isInteger(params.amount) || params.amount <= 0)) throw new Error('兑换方向或数量无效')
}

function isSafeExtensionData(value) {
  if (!isRecord(value)) return false
  try { return Buffer.byteLength(JSON.stringify(value)) <= 16 * 1024 } catch { return false }
}
