'use strict'

/**
 * 1.0.8 empaquetó better-sqlite3 Linux (ELF) dentro del instalador Windows.
 * Electron arrancaba, fallaba al cargar el .node y se quedaba en segundo plano
 * sin ventana. Aquí se baja el prebuild del ABI de Electron para la plataforma
 * destino y se comprueba que el binario nativo coincida (PE en win32).
 */

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const BETTER_SQLITE3 = 'better-sqlite3'
const NATIVE_FILE = path.join('build', 'Release', 'better_sqlite3.node')

function nativeModulePlatform(buf) {
  if (!buf || buf.length < 4) return 'unknown'
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    return 'linux'
  }
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    return 'win32'
  }
  return 'unknown'
}

function archName(arch) {
  if (arch === 'x64' || arch === 1 || arch === 'x86_64') return 'x64'
  if (arch === 'arm64' || arch === 3) return 'arm64'
  if (arch === 'ia32' || arch === 0) return 'ia32'
  return String(arch)
}

function resolvePrebuildArgs({ electronVersion, arch, platform }) {
  return [
    '--runtime=electron',
    `--target=${electronVersion}`,
    `--arch=${archName(arch)}`,
    `--platform=${platform}`
  ]
}

function packagedBetterSqlite3Dir(appOutDir, platform) {
  if (platform === 'darwin') {
    const apps = fs.readdirSync(appOutDir).filter((name) => name.endsWith('.app'))
    const appName = apps[0]
    if (!appName) {
      throw new Error(`No se encontró .app en ${appOutDir}`)
    }
    return path.join(
      appOutDir,
      appName,
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules',
      BETTER_SQLITE3
    )
  }
  return path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', BETTER_SQLITE3)
}

function nativeModulePath(packageDir) {
  return path.join(packageDir, NATIVE_FILE)
}

function expectedPlatform(electronPlatformName) {
  if (electronPlatformName === 'win32') return 'win32'
  if (electronPlatformName === 'linux') return 'linux'
  return null
}

function assertNativeModulePlatform(packageDir, expected) {
  const file = nativeModulePath(packageDir)
  if (!fs.existsSync(file)) {
    throw new Error(`Falta el módulo nativo: ${file}`)
  }
  const actual = nativeModulePlatform(fs.readFileSync(file))
  if (actual !== expected) {
    throw new Error(
      `better-sqlite3 es ${actual}, se esperaba ${expected} (${file}). ` +
        'Un instalador Windows con binario Linux deja la app en segundo plano sin ventana.'
    )
  }
}

function resolvePrebuildBin(packageDir) {
  try {
    return createRequire(path.join(packageDir, 'package.json')).resolve('prebuild-install/bin.js')
  } catch {
    return require.resolve('prebuild-install/bin.js')
  }
}

function installPrebuild(packageDir, args) {
  const prebuildBin = resolvePrebuildBin(packageDir)
  const result = spawnSync(process.execPath, [prebuildBin, ...args], {
    cwd: packageDir,
    stdio: 'inherit'
  })
  if (result.status !== 0) {
    throw new Error(
      `prebuild-install falló (${result.status}): ${args.join(' ')}. ` +
        'El instalador necesita el binario nativo del ABI de Electron.'
    )
  }
}

async function preparePackagedNativeModules(context) {
  const platform = context.electronPlatformName
  const expected = expectedPlatform(platform)
  if (!expected) return

  const packageDir = packagedBetterSqlite3Dir(context.appOutDir, platform)
  if (!fs.existsSync(packageDir)) {
    throw new Error(`better-sqlite3 no está unpacked en ${packageDir}`)
  }

  const electronVersion =
    context.packager?.electronVersion || require('electron/package.json').version
  const args = resolvePrebuildArgs({
    electronVersion,
    arch: context.arch,
    platform
  })
  installPrebuild(packageDir, args)
  assertNativeModulePlatform(packageDir, expected)
}

module.exports = preparePackagedNativeModules
module.exports.default = preparePackagedNativeModules
module.exports.nativeModulePlatform = nativeModulePlatform
module.exports.resolvePrebuildArgs = resolvePrebuildArgs
module.exports.archName = archName
module.exports.assertNativeModulePlatform = assertNativeModulePlatform
module.exports.packagedBetterSqlite3Dir = packagedBetterSqlite3Dir
module.exports.expectedPlatform = expectedPlatform
module.exports.installPrebuild = installPrebuild
