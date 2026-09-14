import { spawn } from 'node:child_process'
import electron from 'electron'

const args = [
  '--test',
  '--experimental-strip-types',
  '--import',
  './scripts/ts-test-register.mjs',
  'src/main/db/repos/templates.publish.test.ts'
]

const child = spawn(String(electron), args, {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit'
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
