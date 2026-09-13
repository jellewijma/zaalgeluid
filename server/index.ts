import { createAppServer } from './app.js'

const rawPort = process.env.PORT ?? '3000'
const port = Number(rawPort)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT moet een geldig poortnummer tussen 1 en 65535 zijn.')
const instance = await createAppServer({ port, host: process.env.HOST ?? '0.0.0.0', dev: process.argv.includes('--dev'), dataDir: process.env.DATA_DIR, basePath: process.env.APP_BASE_PATH })
const { url } = await instance.listen()
console.log(`\n  Zaalgeluid is gestart: ${url}/player\n  Open deze link op de PA-computer. Daar vind je de tabletlink en koppelcode.\n`)
let closing = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (closing) return
  closing = true
  void instance.close().then(() => process.exit(0))
})
