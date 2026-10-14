// @ts-check
/** Codex 插件内的桌面 IPC 客户端。 */
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'

const BRIDGE_VERSION = 1
function codexHome() {
  const sharedHome = process.env.DSH_PIGGY_HOME
  if (typeof sharedHome === 'string' && sharedHome.trim() !== '') return sharedHome
  const configured = process.env.CODEX_HOME
  return typeof configured === 'string' && configured.trim() !== '' ? configured : join(homedir(), '.codex')
}
function pairingPath() { return join(codexHome(), 'dsh-piggy-pairing.json') }

export function readPairing() {
  let pairing
  try { pairing = JSON.parse(readFileSync(pairingPath(), 'utf8')) } catch (error) {
    throw new Error(`桌面小猪没有配对凭据，请先启动桌面版：${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof pairing?.endpoint !== 'string' || typeof pairing?.pairingToken !== 'string') throw new Error('桌面小猪配对文件无效，请重启桌面版')
  return { endpoint: pairing.endpoint, token: pairing.pairingToken }
}

/** 超时后不自动重试，避免重复执行消费类操作。 */
export function requestDesktop(method, fields = {}, timeoutMs = 1200) {
  const pairing = readPairing()
  const id = randomUUID()
  const body = { ...fields, version: BRIDGE_VERSION, id, method, token: pairing.token }
  return new Promise((resolve, reject) => {
    const socket = createConnection(pairing.endpoint)
    socket.setEncoding('utf8')
    let buffer = ''
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(result)
    }
    const timer = setTimeout(() => finish(new Error('桌面小猪连接超时；先重新查询状态，勿重复执行写操作')), timeoutMs)
    timer.unref?.()
    socket.on('connect', () => socket.write(`${JSON.stringify(body)}\n`))
    socket.on('data', chunk => {
      buffer += chunk
      if (Buffer.byteLength(buffer) > 1024 * 1024) { finish(new Error('桌面小猪响应超出大小限制')); return }
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      try {
        const response = JSON.parse(buffer.slice(0, newline))
        if (response.id !== id) throw new Error('桌面小猪响应编号不匹配')
        if (response.ok !== true) throw new Error(response.error ?? '桌面小猪拒绝了请求')
        finish(null, response.result)
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    })
    socket.on('error', error => finish(new Error(`桌面小猪未运行或未连接：${error.message}`)))
  })
}

function bindingPath() { return join(codexHome(), 'dsh-piggy-binding.json') }
function getBoundPigId() {
  try {
    const id = JSON.parse(readFileSync(bindingPath(), 'utf8'))?.pigId
    return typeof id === 'string' ? id : null
  } catch { return null }
}
function setBoundPigId(pigId) {
  const file = bindingPath()
  const temp = `${file}.${randomUUID()}.tmp`
  mkdirSync(codexHome(), { recursive: true, mode: 0o700 })
  writeFileSync(temp, `${JSON.stringify({ paired: true, pigId: typeof pigId === 'string' ? pigId : null })}\n`, { mode: 0o600 })
  if (process.platform !== 'win32') chmodSync(temp, 0o600)
  renameSync(temp, file)
}
export function getBinding() { return getBoundPigId() }
export function hasBinding() {
  try {
    const binding = JSON.parse(readFileSync(bindingPath(), 'utf8'))
    return binding?.paired === true && (binding.pigId === null || typeof binding.pigId === 'string' && /^[0-9a-f-]{36}$/i.test(binding.pigId))
  } catch { return false }
}
export { setBoundPigId }
