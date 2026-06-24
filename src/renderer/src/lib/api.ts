import type { Api } from '../../../shared/api'

export const api: Api = window.api

export function formatBytes(v: string | number): string {
  let n = typeof v === 'string' ? parseInt(v, 10) : v
  if (!Number.isFinite(n)) n = 0
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(iso: string): string {
  // SQLite datetime('now') es UTC: 'YYYY-MM-DD HH:MM:SS'
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}
