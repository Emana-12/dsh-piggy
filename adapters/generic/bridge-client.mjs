// 通用 CLI 适配器模板：目标 AI 必须按目标 CLI 的运行时和凭据目录改造。
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'

export function readPairing(home = process.env.CODEX_HOME || join(homedir(), '.codex')) {
  const file = join(home, 'dsh-piggy-pairing.json')
  const pairing = JSON.parse(readFileSync(file, 'utf8'))
  if (typeof pairing.endpoint !== 'string' || typeof pairing.pairingToken !== 'string') throw new Error('配对文件格式无效')
  return pairing
}

export function requestDesktop(method, fields = {}, timeoutMs = 1200) {
  const pairing = readPairing()
  const id = randomUUID()
  const body = JSON.stringify({ version: 1, id, method, token: pairing.pairingToken, ...fields }) + '\n'
  return new Promise((resolve, reject) => {
    const socket = createConnection(pairing.endpoint)
    let buffer = ''
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('桌面桥连接超时')) }, timeoutMs)
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(body))
    socket.on('data', chunk => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end < 0) return
      clearTimeout(timer)
      socket.destroy()
      const response = JSON.parse(buffer.slice(0, end))
      if (response.ok !== true) reject(new Error(response.error || '桌面桥拒绝请求'))
      else resolve(response.result)
    })
    socket.on('error', error => { clearTimeout(timer); reject(error) })
  })
}
