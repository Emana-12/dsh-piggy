// @ts-check
/** Codex 插件的轻量 MCP stdio 入口，只经认证本机桥访问桌面 store。 */
import { randomUUID } from 'node:crypto'
import { getBinding, hasBinding, requestDesktop, setBoundPigId } from './lib/bridge-client.js'

const SERVER_INFO = { name: 'dsh-piggy', version: '0.1.0' }
const MAX_LINE_BYTES = 1024 * 1024
const MAX_IN_FLIGHT = 32
const ACTION_FIELDS = Object.freeze({
  hatch: [], adopt: ['confirm'], reset: ['confirm'], feed: ['item'], bathe: ['item'], play: ['item'], pet: ['part'], reply: ['line', 'index'],
  signIn: [], pomodoro: ['minutes'], pomodoroAbandon: [], openGift: [], removeExtension: ['key', 'confirm'], installExtension: ['key', 'confirm'],
  ext: ['key', 'op', 'data'], setExtension: ['key', 'on'], chat: ['reason'], quiet: ['on'], owner: ['name'], catchphrase: ['text'], motto: ['text'],
  crown: ['form'], name: ['name'], work: ['job', 'short'], study: ['subject', 'stage'], interest: ['interest'], trip: ['trip'], fishCast: ['power', 'bait'],
  fishHook: [], fishResolve: ['success'], fishKeep: [], fishFeed: ['id'], fishSell: ['id'], fishRod: [], fishAutomation: ['kind'], fishCollect: [],
  fishSpot: ['spot'], exchange: ['key', 'direction', 'amount'], fishAuto: ['minutes', 'bait'], fishGive: ['fish'], fishSkip: [], skin: ['skin', 'confirm'],
  calloff: [], buy: ['item'], use: ['item'], doctor: [], sell: ['souvenir'], wear: ['item', 'on'],
})
const ACTIONS = Object.keys(ACTION_FIELDS)
const REQUIRED_FIELDS = Object.freeze({
  adopt: ['confirm'], reset: ['confirm'],
  feed: ['item'], bathe: ['item'], play: ['item'], pet: ['part'], reply: ['line', 'index'], pomodoro: ['minutes'],
  removeExtension: ['key', 'confirm'], installExtension: ['key', 'confirm'], ext: ['key', 'op'], setExtension: ['key', 'on'],
  owner: ['name'], catchphrase: ['text'], motto: ['text'], crown: ['form'], name: ['name'], work: ['job'], study: ['subject', 'stage'],
  interest: ['interest'], trip: ['trip'], fishCast: ['power', 'bait'], fishResolve: ['success'], fishFeed: ['id'], fishSell: ['id'],
  fishAutomation: ['kind'], fishSpot: ['spot'], exchange: ['key', 'direction', 'amount'], fishAuto: ['minutes', 'bait'], fishGive: ['fish'],
  skin: ['skin', 'confirm'], buy: ['item'], use: ['item'], sell: ['souvenir'], wear: ['item'],
})
const STRING_FIELDS = new Set(['confirm', 'item', 'part', 'key', 'op', 'reason', 'name', 'text', 'form', 'job', 'subject', 'stage', 'interest', 'trip', 'bait', 'id', 'kind', 'spot', 'direction', 'fish', 'skin', 'souvenir'])
const NUMBER_FIELDS = new Set(['line', 'index', 'minutes', 'power', 'amount'])
const BOOLEAN_FIELDS = new Set(['on', 'short', 'success'])
const DANGEROUS_ACTIONS = new Set(['adopt', 'reset', 'removeExtension', 'installExtension', 'skin'])

const TOOLS = [
  { name: 'piggy_pair', description: '明确将 Codex 绑定到当前桌面小猪。仅在用户要求连接或重新配对时调用。空存档也可以绑定，之后可在 Codex 内开盒。', inputSchema: emptySchema(), annotations: { readOnlyHint: false, openWorldHint: false } },
  { name: 'piggy_status', description: '读取已绑定桌面小猪的当前养成状态。不会自动更换绑定；首次使用前先调用 piggy_pair。', inputSchema: emptySchema(), annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'piggy_extensions', description: '列出桌面存档中的扩展状态和可用的官方在线扩展目录；不会执行目录代码或改动存档。', inputSchema: emptySchema(), annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'piggy_action', description: '在已绑定的同一只桌面小猪上执行养成操作。不要传 pigId，服务只使用本地已确认的绑定。空存档可以开盒。写操作影响桌面真实存档；超时后先查状态，不要重试。重置、领养覆盖、安装/卸载扩展、替换皮肤前，先说明具体影响并取得用户明确确认，再传 confirm="我确认"。', inputSchema: actionSchema(), annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } },
]

function emptySchema() { return { type: 'object', properties: {}, additionalProperties: false } }

function actionSchema() {
  return {
    type: 'object',
    oneOf: Object.entries(ACTION_FIELDS).map(([action, fields]) => ({
      type: 'object',
      properties: {
        action: { type: 'string', const: action },
        params: {
          type: 'object',
          properties: Object.fromEntries(fields.map(field => [field, fieldSchema(action, field)])),
          ...(REQUIRED_FIELDS[action] ? { required: REQUIRED_FIELDS[action] } : {}),
          additionalProperties: false,
        },
      },
      required: ['action', 'params'],
      additionalProperties: false,
    })),
  }
}

function fieldSchema(action, field) {
  if (STRING_FIELDS.has(field)) {
    if (field === 'confirm') return { type: 'string', enum: ['我确认'] }
    if (field === 'direction') return { type: 'string', enum: ['toGold', 'fromGold'] }
    if (field === 'key') return { type: 'string', pattern: '^[a-z0-9-]{2,24}$', maxLength: 24 }
    return { type: 'string', maxLength: field === 'op' ? 80 : 512 }
  }
  if (NUMBER_FIELDS.has(field)) {
    if (action === 'pomodoro') return { type: 'integer', enum: [15, 25, 45] }
    if (action === 'fishAuto') return { type: 'integer', enum: [30, 60, 120, 240] }
    if (field === 'amount') return { type: 'integer', minimum: 1 }
    return { type: field === 'line' || field === 'index' || field === 'minutes' ? 'integer' : 'number', minimum: 0, ...(field === 'power' ? { maximum: 1 } : {}) }
  }
  if (BOOLEAN_FIELDS.has(field)) return { type: 'boolean' }
  if (field === 'data') return { type: 'object' }
  throw new Error(`缺少参数 schema：${field}`)
}

function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key) }

function write(message) {
  try { process.stdout.write(`${JSON.stringify(message)}\n`) } catch { /* stdout 已关闭时只允许子进程结束 */ }
}

function rpcError(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

function toolError(id, message) {
  write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: message }], isError: true } })
}

function toolResult(id, result) {
  write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result } })
}

function validateActionArguments(args) {
  if (!isRecord(args) || Object.keys(args).some(key => !['action', 'params'].includes(key))) throw new Error('piggy_action 参数只能包含 action 和 params。')
  if (typeof args.action !== 'string' || !hasOwn(ACTION_FIELDS, args.action)) throw new Error('未开放这个养成操作。')
  if (!isRecord(args.params)) throw new Error('params 必须是 JSON 对象。')
  const allowed = ACTION_FIELDS[args.action]
  if (Object.keys(args.params).some(key => !allowed.includes(key))) throw new Error(`${args.action} 含不支持的参数。`)
  for (const field of REQUIRED_FIELDS[args.action] ?? []) {
    if (!hasOwn(args.params, field)) throw new Error(`${args.action} 缺少必填参数 ${field}。`)
  }
  for (const [key, value] of Object.entries(args.params)) {
    if (STRING_FIELDS.has(key) && (typeof value !== 'string' || value.length > 512)) throw new Error(`参数 ${key} 必须是 512 字符以内的文本。`)
    if (NUMBER_FIELDS.has(key) && (!Number.isFinite(value) || value < 0)) throw new Error(`参数 ${key} 必须是非负数。`)
    if (['line', 'index', 'minutes'].includes(key) && !Number.isInteger(value)) throw new Error(`参数 ${key} 必须是整数。`)
    if (BOOLEAN_FIELDS.has(key) && typeof value !== 'boolean') throw new Error(`参数 ${key} 必须是布尔值。`)
    if (key === 'data' && (!isRecord(value) || Buffer.byteLength(JSON.stringify(value)) > 16 * 1024)) throw new Error('扩展数据必须是 16 KB 以内的 JSON 对象。')
  }
  if (args.action === 'fishCast' && args.params.power > 1) throw new Error('钓鱼力度必须在 0 到 1 之间。')
  if (args.action === 'pomodoro' && ![15, 25, 45].includes(args.params.minutes)) throw new Error('番茄钟时长只能选择 15、25 或 45 分钟。')
  if (args.action === 'fishAuto' && ![30, 60, 120, 240].includes(args.params.minutes)) throw new Error('自动钓鱼时长不受支持。')
  if (args.action === 'exchange' && (!Number.isInteger(args.params.amount) || args.params.amount < 1 || !['toGold', 'fromGold'].includes(args.params.direction))) throw new Error('兑换方向或数量无效。')
  if (args.action === 'ext' && (!/^[a-z0-9-]{2,24}$/.test(args.params.key) || args.params.op.length > 80)) throw new Error('扩展标识或操作名无效。')
  if (['removeExtension', 'installExtension', 'setExtension'].includes(args.action) && !/^[a-z0-9-]{2,24}$/.test(args.params.key)) throw new Error('扩展标识无效。')
  if (DANGEROUS_ACTIONS.has(args.action) && args.params.confirm !== '我确认') throw new Error('这项操作需要先向用户说明影响并取得明确确认，再设置 confirm="我确认"。')
}

async function callTool(name, args) {
  if (!isRecord(args)) throw new Error('工具 arguments 必须是 JSON 对象。')
  if (name === 'piggy_pair') {
    if (Object.keys(args).length > 0) throw new Error('piggy_pair 不接受参数。')
    const result = await requestDesktop('pair')
    if (!isRecord(result) || (result.pigId !== null && typeof result.pigId !== 'string')) throw new Error('桌面存档返回了无效身份，未更改当前绑定。')
    setBoundPigId(result.pigId)
    return result
  }
  if (name === 'piggy_status') {
    if (Object.keys(args).length > 0) throw new Error('piggy_status 不接受参数。')
    if (!hasBinding()) throw new Error('尚未绑定桌面小猪。请先调用 piggy_pair；此操作不会修改存档。')
    return requestDesktop('status', { pigId: getBinding() })
  }
  if (name === 'piggy_extensions') {
    if (Object.keys(args).length > 0) throw new Error('piggy_extensions 不接受参数。')
    if (!hasBinding()) throw new Error('尚未绑定桌面小猪。请先调用 piggy_pair。')
    return requestDesktop('extensions', { pigId: getBinding() }, 25_000)
  }
  if (name === 'piggy_action') {
    validateActionArguments(args)
    if (!hasBinding()) throw new Error('尚未绑定桌面小猪。请先调用 piggy_pair；请勿通过未绑定状态执行养成操作。')
    const pigId = getBinding()
    const result = await requestDesktop('action', { pigId, operation: args.action, params: args.params, requestId: randomUUID() })
    if (args.action === 'hatch' && result?.ok === true && typeof result.pigId === 'string') setBoundPigId(result.pigId)
    return result
  }
  throw new Error('未知的小猪工具。')
}

async function handle(message) {
  if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    rpcError(message?.id ?? null, -32600, '无效的 JSON-RPC 请求。')
    return
  }
  const id = hasOwn(message, 'id') ? message.id : undefined
  if (id !== undefined && id !== null && typeof id !== 'string' && typeof id !== 'number') {
    rpcError(null, -32600, 'JSON-RPC id 必须是字符串、数字或 null。')
    return
  }
  if (hasOwn(message, 'params') && !isRecord(message.params)) {
    if (id !== undefined) rpcError(id, -32602, 'params 必须是 JSON 对象。')
    return
  }
  const params = hasOwn(message, 'params') ? message.params : {}
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return
  if (id === undefined) return
  if (message.method === 'initialize') {
    write({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: '本插件只控制当前绑定的桌面小猪。先调用 piggy_pair；所有写操作都发生在桌面真实存档。' } })
    return
  }
  if (message.method === 'ping') { write({ jsonrpc: '2.0', id, result: {} }); return }
  if (message.method === 'tools/list') { write({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return }
  if (message.method !== 'tools/call') { rpcError(id, -32601, `不支持的方法：${message.method}`); return }
  if (Object.keys(params).some(key => !['name', 'arguments'].includes(key))) { toolError(id, 'tools/call 参数只能包含 name 和 arguments。'); return }
  if (typeof params.name !== 'string' || !TOOLS.some(tool => tool.name === params.name)) {
    toolError(id, '未知的小猪工具。')
    return
  }
  if (hasOwn(params, 'arguments') && !isRecord(params.arguments)) { toolError(id, 'arguments 必须是 JSON 对象。'); return }
  try {
    toolResult(id, await callTool(params.name, params.arguments ?? {}))
  } catch (error) {
    toolError(id, error instanceof Error ? error.message : String(error))
  }
}

let inputBuffer = ''
let inFlight = 0
let stopped = false
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  if (stopped) return
  inputBuffer += chunk
  let newline
  while ((newline = inputBuffer.indexOf('\n')) >= 0) {
    const line = inputBuffer.slice(0, newline)
    inputBuffer = inputBuffer.slice(newline + 1)
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
      rpcError(null, -32700, 'MCP 请求超过 1 MiB 上限。')
      stopped = true
      process.stdin.pause()
      return
    }
    let message
    try { message = JSON.parse(line) } catch {
      rpcError(null, -32700, 'MCP 请求不是有效 JSON。')
      continue
    }
    if (inFlight >= MAX_IN_FLIGHT) {
      rpcError(message?.id ?? null, -32000, 'MCP 请求过多，请稍后重试。')
      continue
    }
    inFlight += 1
    void handle(message).catch(error => rpcError(message?.id ?? null, -32603, error instanceof Error ? error.message : String(error))).finally(() => { inFlight -= 1 })
  }
  if (Buffer.byteLength(inputBuffer) > MAX_LINE_BYTES) {
    rpcError(null, -32700, 'MCP 请求超过 1 MiB 上限。')
    inputBuffer = ''
    stopped = true
    process.stdin.pause()
  }
})
