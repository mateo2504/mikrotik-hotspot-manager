// Tipos compartidos entre main, preload y renderer

export type ApiType = 'auto' | 'rest' | 'binary'

export interface RouterRecord {
  id: number
  name: string
  host: string
  port: number | null // null = puerto por defecto según tipo de API
  hotspotHost: string | null // IP/DNS para el QR del portal hotspot (separado de host)
  username: string
  useSsl: boolean
  apiType: ApiType
  detectedApi: 'rest' | 'binary' | null
  createdAt: string
}

export interface RouterInput {
  name: string
  host: string
  port: number | null
  hotspotHost: string | null // IP/DNS para el QR del portal hotspot
  username: string
  password: string | null // null en edición = sin cambios
  useSsl: boolean
  apiType: ApiType
}

export interface ConnectResult {
  ok: boolean
  identity?: string
  version?: string
  api?: 'rest' | 'binary'
  error?: string
}

// ---- Planes ----

export type PlanType = 'pausado' | 'corrido'

export interface PlanMeta {
  profileName: string
  price: string
  planType: PlanType
  validity: string // ej. '3d', '12h'
  uptimeLimit: string // solo pausado, ej. '5h'
  macAleatoria: boolean // si true, fuerza shared-users=2 y limpia sesiones de otra MAC
  notes: string
}

export interface HotspotProfile {
  rosId: string
  name: string
  rateLimit: string
  sharedUsers: string
  sessionTimeout: string
  idleTimeout: string
  meta: PlanMeta | null
}

export interface ProfileInput {
  name: string
  rateLimit: string
  sharedUsers: string
  price: string
  planType: PlanType
  validity: string
  uptimeLimit: string
  macAleatoria: boolean
}

// ---- Usuarios ----

export interface HotspotUser {
  rosId: string
  name: string
  password: string
  profile: string
  comment: string
  limitUptime: string
  uptime: string
  bytesIn: string
  bytesOut: string
  disabled: boolean
}

export interface UserInput {
  name: string
  password: string
  profile: string
  comment: string
}

// ---- Activos ----

export interface ActiveSession {
  rosId: string
  user: string
  address: string
  macAddress: string
  uptime: string
  bytesIn: string
  bytesOut: string
  loginBy: string
}

// ---- Hotspot Hosts ----

export interface HotspotHost {
  rosId: string
  macAddress: string
  address: string
  toAddress: string
  server: string
  uptime: string
  bytesIn: string
  bytesOut: string
  comment: string
  authorized: boolean
  bypassed: boolean
  blocked: boolean
}

// ---- IP Binding ----

export type IpBindingType = 'regular' | 'bypassed' | 'blocked'
export type IpBindingExpiry = 'none' | '1h' | '1d' | '3d' | '7d' | '30d'

export interface IpBinding {
  rosId: string
  macAddress: string
  address: string
  type: IpBindingType
  comment: string
  disabled: boolean
  hasScheduler: boolean
  schedulerName?: string
  schedulerInterval?: string
}

export interface IpBindingInput {
  macAddress: string
  address: string
  type: IpBindingType
  comment: string
  expiryValue: number
  expiryUnit: 'm' | 'h' | 'd'
  isVip: boolean
}

export function buildInterval(v: number, u: 'm' | 'h' | 'd'): string {
  return `${v}${u}`
}

// ---- Lotes ----

export type CodeCharset = 'num' | 'lower' | 'upper' | 'alnum'

export interface CodeOptions {
  qty: number
  prefix: string
  length: number // longitud del código (sin prefijo)
  charset: CodeCharset
  userMode: 'same' | 'separate' | 'userOnly' // same: usuario == clave, separate: distintos, userOnly: solo usuario sin clave
  passwordLength: number // solo separate
  passwordCharset: CodeCharset // solo separate
}

export interface Batch {
  id: number
  routerId: number
  profileName: string
  qty: number
  prefix: string
  codeOptions: CodeOptions
  createdAt: string
  commentTag: string
  voucherCount: number
}

export interface Voucher {
  id: number
  batchId: number
  username: string
  password: string
  createdOnRouter: boolean
}

export interface GenerateBatchInput {
  profileName: string
  codeOptions: CodeOptions
}

export interface GenerateBatchResult {
  ok: boolean
  batchId?: number
  created?: number
  failed?: number
  error?: string
}

export interface GenerateProgress {
  done: number
  total: number
}

export interface DeleteBatchResult {
  ok: boolean
  removedFromRouter?: number
  error?: string
}

// ---- Plantillas ----

export type TemplateKind = 'a4' | 'thermal'

export type FieldId =
  | 'header'
  | 'plan'
  | 'usuario'
  | 'password'
  | 'price'
  | 'validity'
  | 'footer'

export interface TemplateField {
  id: FieldId
  label: string // texto para header/footer; etiqueta para los demás (ej. 'Usuario')
  visible: boolean
  size: 's' | 'm' | 'l'
  bold: boolean
  align: 'left' | 'center' | 'right'
}

export interface TemplateConfig {
  kind: TemplateKind
  page: 'A4' | 'Letter' // solo a4
  cols: number // solo a4
  rows: number // solo a4
  thermalWidth: 58 | 80 // solo thermal
  paddingMm: number
  bgMode: 'cover' | 'contain' | 'stretch'
  textColor?: string // color general de letra, ej. '#000000'
  fontFamily?: string // tipo de letra general, ej. 'Arial'
  fields: TemplateField[]
  qrEnabled?: boolean
  qrPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'bottom-center' | 'center'
  qrSize?: number // 0–100, porcentaje del ancho de la ficha
  qrOpacity?: number // 0–1
}

export interface Template {
  id: number
  name: string
  kind: TemplateKind
  config: TemplateConfig
  bgImagePath: string | null
  bgDataUrl: string | null // resuelto por main para preview/impresión
  createdAt: string
}

export interface TemplateInput {
  name: string
  kind: TemplateKind
  config: TemplateConfig
  bgImagePath: string | null
}

// ---- Datos de ficha para imprimir ----

export interface VoucherPrintData {
  username: string
  password: string
  plan: string
  price: string
  validity: string
  userEqualsPass: boolean
  userOnly?: boolean
  routerHost?: string
  qrDataUrl?: string
}

// ---- Impresión ----

export interface PrinterInfo {
  name: string
  isDefault: boolean
}

export interface PrintBatchInput {
  batchId: number
  templateId: number
  printerName?: string
  silent: boolean
  onlyActive?: boolean // omitir fichas que ya no están en el router (por defecto true)
}

export interface PrintResult {
  ok: boolean
  error?: string
  printed?: number // fichas efectivamente impresas/exportadas
  total?: number // total de fichas del lote
  verified?: boolean // true si se pudo verificar contra el router
}

export interface PreviewResult {
  html: string
  printed: number
  total: number
  verified: boolean
}

export interface SimpleResult {
  ok: boolean
  error?: string
}
