import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const native = require('../../scripts/prepare-native-modules.cjs') as {
  nativeModulePlatform: (buf: Buffer) => string
  resolvePrebuildArgs: (opts: {
    electronVersion: string
    arch: string | number
    platform: string
  }) => string[]
  archName: (arch: string | number) => string
  assertNativeModulePlatform: (packageDir: string, expected: string) => void
  packagedBetterSqlite3Dir: (appOutDir: string, platform: string) => string
  expectedPlatform: (name: string) => string | null
}

describe('prepare-native-modules', () => {
  it('detecta ELF Linux vs PE Windows', () => {
    assert.equal(native.nativeModulePlatform(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), 'linux')
    assert.equal(native.nativeModulePlatform(Buffer.from([0x4d, 0x5a, 0x90, 0x00])), 'win32')
    assert.equal(native.nativeModulePlatform(Buffer.from([0x00, 0x00])), 'unknown')
  })

  it('pide el prebuild de Electron para win32 x64', () => {
    assert.deepEqual(
      native.resolvePrebuildArgs({ electronVersion: '39.8.10', arch: 'x64', platform: 'win32' }),
      ['--runtime=electron', '--target=39.8.10', '--arch=x64', '--platform=win32']
    )
    assert.equal(native.archName(1), 'x64')
    assert.equal(native.expectedPlatform('win32'), 'win32')
  })

  it('resuelve la ruta unpacked de Windows', () => {
    assert.equal(
      native.packagedBetterSqlite3Dir('/app/dist/win-unpacked', 'win32'),
      '/app/dist/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3'
    )
  })

  it('rechaza un .node Linux cuando el destino es Windows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bsql-'))
    try {
      const release = join(dir, 'build', 'Release')
      mkdirSync(release, { recursive: true })
      writeFileSync(
        join(release, 'better_sqlite3.node'),
        Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02])
      )
      assert.throws(
        () => native.assertNativeModulePlatform(dir, 'win32'),
        /binario Linux|se esperaba win32|es linux/
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('acepta un .node PE para Windows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bsql-'))
    try {
      const release = join(dir, 'build', 'Release')
      mkdirSync(release, { recursive: true })
      writeFileSync(join(release, 'better_sqlite3.node'), Buffer.from([0x4d, 0x5a, 0x90, 0x00]))
      native.assertNativeModulePlatform(dir, 'win32')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
