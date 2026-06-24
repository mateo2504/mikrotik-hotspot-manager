import { safeStorage } from 'electron'

export function encryptPassword(plain: string): Buffer {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain)
  }
  // Fallback marcado: nunca debería ocurrir en Windows con DPAPI disponible
  return Buffer.concat([Buffer.from('PLAIN:'), Buffer.from(plain, 'utf8')])
}

export function decryptPassword(enc: Buffer): string {
  const prefix = enc.subarray(0, 6).toString()
  if (prefix === 'PLAIN:') {
    return enc.subarray(6).toString('utf8')
  }
  return safeStorage.decryptString(enc)
}
