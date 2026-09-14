import { existsSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TS_EXT = new Set(['', '.ts', '.js'])

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !extname(specifier)) {
    const parent = dirname(fileURLToPath(context.parentURL))
    const tsPath = join(parent, `${specifier}.ts`)
    if (existsSync(tsPath)) {
      return nextResolve(pathToFileURL(tsPath).href, context)
    }
  }
  return nextResolve(specifier, context)
}

export function load(url, context, nextLoad) {
  return nextLoad(url, context)
}
