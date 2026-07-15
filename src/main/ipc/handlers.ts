import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { copyFileSync, mkdirSync } from 'fs'
import { basename, join } from 'path'
import QRCode from 'qrcode'
import type {
  CodeOptions,
  IpBindingInput,
  PrintBatchInput,
  ProfileInput,
  RouterInput,
  TemplateInput,
  UserInput,
  VoucherPrintData
} from '../../shared/types'
import * as routersRepo from '../db/repos/routers'
import * as planMetaRepo from '../db/repos/planMeta'
import * as batchesRepo from '../db/repos/batches'
import * as templatesRepo from '../db/repos/templates'
import * as settingsRepo from '../db/repos/settings'
import { connectRouter, type ConnectedRouter, type RouterClient } from '../routeros/client'
import {
  PROFILE_PATH,
  USER_PATH,
  addIpBinding,
  convertHostToIpBinding,
  disableIpBinding,
  disconnectActive,
  enableIpBinding,
  findUsersByComment,
  listActive,
  listHosts,
  listIpBindings,
  listProfiles,
  listUsers,
  profileProps,
  removeExpirySchedulers,
  removeIpBinding,
  removeUsers,
  updateIpBinding,
  userProps
} from '../routeros/hotspot'
import { generateBatch, resumeBatch } from '../services/batchGenerator'
import { exportPdf, listPrinters, printHtml } from '../services/printer'
import { defaultTemplates, renderVoucherHTML } from '../../shared/voucherRender'

interface Session extends ConnectedRouter {
  routerId: number
}

let session: Session | null = null
const sessionChangeListeners = new Set<() => void>()

function setSession(next: Session | null): void {
  session = next
  for (const listener of sessionChangeListeners) listener()
}

function waitForReplacementClient(
  routerId: number,
  previousClient: RouterClient,
  timeoutMs = 60_000
): Promise<RouterClient> {
  if (session?.routerId === routerId && session.client !== previousClient) {
    return Promise.resolve(session.client)
  }

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      sessionChangeListeners.delete(check)
    }
    const check = (): void => {
      if (session?.routerId === routerId && session.client !== previousClient) {
        const nextClient = session.client
        cleanup()
        resolve(nextClient)
      }
    }
    const timer = setTimeout(() => {
      sessionChangeListeners.delete(check)
      reject(new Error('No se pudo recuperar la conexión para continuar el lote'))
    }, timeoutMs)
    sessionChangeListeners.add(check)
    check()
  })
}

function client(): ConnectedRouter['client'] {
  if (!session) throw new Error('No hay conexión activa con el router')
  return session.client
}

function sessionRouterId(): number {
  if (!session) throw new Error('No hay conexion activa con el router')
  return session.routerId
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Usernames del lote presentes AHORA en el router, o null si no se puede verificar */
async function presentUsernames(batchId: number): Promise<Set<string> | null> {
  const batch = batchesRepo.getBatch(batchId)
  if (!batch) return null
  if (!session || session.routerId !== batch.routerId) return null
  const users = await findUsersByComment(session.client, batch.commentTag)
  return new Set(users.map((u) => u.name ?? '').filter(Boolean))
}

/**
 * Datos de impresión de un lote: fichas + info del plan.
 * Con onlyActive=true se omiten las fichas que ya no existen en el router
 * (expiradas o eliminadas), para no reimprimirlas. Si no hay conexión al router
 * del lote, no se filtra (se imprime lo guardado).
 */
async function buildPrintData(
  batchId: number,
  onlyActive: boolean
): Promise<{ data: VoucherPrintData[]; total: number; verified: boolean }> {
  const batch = batchesRepo.getBatch(batchId)
  if (!batch) throw new Error('Lote no encontrado')
  const meta = planMetaRepo.getPlanMeta(batch.routerId, batch.profileName)
  const userEqualsPass = batch.codeOptions.userMode === 'same'
  const userOnly = batch.codeOptions.userMode === 'userOnly'
  let vouchers = batchesRepo.getVouchers(batchId)
  const total = vouchers.length
  let verified = false
  if (onlyActive) {
    const present = await presentUsernames(batchId)
    if (present) {
      vouchers = vouchers.filter((v) => present.has(v.username))
      verified = true
    }
  }
  const router = routersRepo.getRouter(batch.routerId)
  const qrHost = router?.hotspotHost || router?.host || ''
  let qrDataUrl: string | undefined
  if (qrHost) {
    try {
      // URL del portal hotspot para escanear con el celular
      qrDataUrl = await QRCode.toDataURL(`http://${qrHost}`, { width: 200, margin: 1, type: 'image/png' })
    } catch {
      qrDataUrl = undefined
    }
  }
  const data = vouchers.map((v) => ({
    username: v.username,
    password: v.password,
    plan: batch.profileName,
    price: meta?.price ?? '',
    validity: meta?.validity ?? '',
    userEqualsPass,
    userOnly,
    routerHost: qrHost,
    qrDataUrl
  }))
  return { data, total, verified }
}

async function renderBatchHtml(
  batchId: number,
  templateId: number,
  onlyActive: boolean,
  forPreview = false
): Promise<{ html: string; printed: number; total: number; verified: boolean }> {
  const batch = batchesRepo.getBatch(batchId)
  if (!batch) throw new Error('Lote no encontrado')
  const template = templatesRepo.getTemplate(templateId, batch.routerId)
  if (!template) throw new Error('Plantilla no encontrada para este router')
  const { data, total, verified } = await buildPrintData(batchId, onlyActive)
  const printed = data.length
  let slice = data
  if (forPreview) {
    // Solo la primera página: la vista previa no necesita el lote completo
    const limit =
      template.config.kind === 'a4'
        ? Math.max(1, template.config.cols * template.config.rows)
        : 3
    slice = data.slice(0, limit)
  }
  return {
    html: renderVoucherHTML(template.config, template.bgDataUrl, slice, forPreview),
    printed,
    total,
    verified
  }
}

export function seedDefaultTemplates(routerId: number): void {
  if (templatesRepo.countTemplates(routerId) > 0) return
  for (const t of defaultTemplates()) {
    templatesRepo.createTemplate(routerId, {
      name: t.name,
      kind: t.config.kind,
      config: t.config,
      bgImagePath: null
    })
  }
}

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  // ---- Routers ----
  ipcMain.handle('routers:list', () => routersRepo.listRouters())
  ipcMain.handle('routers:create', (_e, input: RouterInput) => routersRepo.createRouter(input))
  ipcMain.handle('routers:update', (_e, id: number, input: RouterInput) =>
    routersRepo.updateRouter(id, input)
  )
  ipcMain.handle('routers:delete', (_e, id: number) => routersRepo.deleteRouter(id))

  ipcMain.handle('router:connect', async (_e, id: number) => {
    try {
      if (session) {
        await session.client.close()
        setSession(null)
      }
      const record = routersRepo.getRouter(id)
      if (!record) throw new Error('Router no encontrado')
      const password = routersRepo.getRouterPassword(id)
      const connected = await connectRouter(
        {
          host: record.host,
          port: record.port,
          username: record.username,
          password,
          useSsl: record.useSsl
        },
        record.apiType,
        record.detectedApi
      )
      setSession({ ...connected, routerId: id })
      connected.client.onDisconnect?.((error) => {
        // No tocar una sesión nueva si el aviso pertenece a una conexión anterior.
        if (!session || session.client !== connected.client) return
        setSession(null)
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('router:connection-lost', { error: errMsg(error) })
        }
      })
      seedDefaultTemplates(id)
      if (record.apiType === 'auto') routersRepo.setDetectedApi(id, connected.api)
      return { ok: true, identity: connected.identity, version: connected.version, api: connected.api }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })

  ipcMain.handle('router:disconnect', async () => {
    if (session) {
      await session.client.close()
      setSession(null)
    }
    return { ok: true }
  })

  // ---- Planes ----
  ipcMain.handle('profiles:list', () => listProfiles(client(), sessionRouterId()))
  ipcMain.handle('profiles:create', async (_e, input: ProfileInput) => {
    try {
      await client().add(PROFILE_PATH, profileProps(input))
      planMetaRepo.upsertPlanMeta(sessionRouterId(), {
        profileName: input.name,
        price: input.price,
        planType: input.planType,
        validity: input.validity,
        uptimeLimit: input.planType === 'pausado' ? input.uptimeLimit : '',
        macAleatoria: input.macAleatoria,
        notes: ''
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })
  ipcMain.handle(
    'profiles:update',
    async (_e, rosId: string, oldName: string, input: ProfileInput) => {
      try {
        const props = profileProps(input)
        // rate-limit vacío debe limpiarse en el router (shared-users lo fija profileProps)
        if (!input.rateLimit) props['rate-limit'] = ''
        await client().set(PROFILE_PATH, rosId, props)
        if (oldName !== input.name) planMetaRepo.renamePlanMeta(sessionRouterId(), oldName, input.name)
        planMetaRepo.upsertPlanMeta(sessionRouterId(), {
          profileName: input.name,
          price: input.price,
          planType: input.planType,
          validity: input.validity,
          uptimeLimit: input.planType === 'pausado' ? input.uptimeLimit : '',
          macAleatoria: input.macAleatoria,
          notes: ''
        })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: errMsg(err) }
      }
    }
  )
  ipcMain.handle('profiles:delete', async (_e, rosId: string, name: string) => {
    try {
      await client().remove(PROFILE_PATH, [rosId])
      planMetaRepo.deletePlanMeta(sessionRouterId(), name)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })

  // ---- Usuarios ----
  ipcMain.handle('users:list', () => listUsers(client()))
  ipcMain.handle('users:create', async (_e, input: UserInput) => {
    try {
      await client().add(USER_PATH, userProps(sessionRouterId(), input))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })
  ipcMain.handle('users:update', async (_e, rosId: string, input: UserInput) => {
    try {
      await client().set(USER_PATH, rosId, userProps(sessionRouterId(), input))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })
  ipcMain.handle('users:delete', async (_e, rosId: string) => {
    try {
      await client().remove(USER_PATH, [rosId])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })

  // ---- Activos ----
  ipcMain.handle('active:list', () => listActive(client()))
  ipcMain.handle('active:disconnect', async (_e, rosId: string) => {
    try {
      await disconnectActive(client(), rosId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })

  // ---- Hotspot Hosts ----
  ipcMain.handle('hosts:list', () => listHosts(client()))
  ipcMain.handle('hosts:convertToIpBinding', async (_e, input: IpBindingInput) => {
    try {
      await convertHostToIpBinding(client(), input)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })

  // ---- IP Binding ----
  ipcMain.handle('ipBindings:list', () => listIpBindings(client()))
  ipcMain.handle('ipBindings:create', async (_e, input: IpBindingInput) => {
    try {
      await addIpBinding(client(), input)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })
  ipcMain.handle('ipBindings:update', async (_e, rosId: string, input: IpBindingInput) => {
    try {
      await updateIpBinding(client(), rosId, input)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })
  ipcMain.handle('ipBindings:delete', async (_e, rosId: string) => {
    try {
      await removeIpBinding(client(), rosId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })
  ipcMain.handle('ipBindings:disable', async (_e, rosId: string) => {
    try {
      await disableIpBinding(client(), rosId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })
  ipcMain.handle('ipBindings:enable', async (_e, rosId: string) => {
    try {
      await enableIpBinding(client(), rosId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })

  // ---- Lotes ----
  ipcMain.handle('batches:list', () => {
    if (!session) throw new Error('No hay conexión activa')
    return batchesRepo.listBatches(session.routerId)
  })
  ipcMain.handle('batches:getVouchers', (_e, batchId: number) => batchesRepo.getVouchers(batchId))
  // Verifica EN VIVO contra el router qué fichas del lote siguen existiendo.
  // Devuelve la lista de usernames presentes ahora mismo en el router.
  ipcMain.handle('batches:checkOnRouter', async (_e, batchId: number) => {
    try {
      const batch = batchesRepo.getBatch(batchId)
      if (!batch) throw new Error('Lote no encontrado')
      if (!session || session.routerId !== batch.routerId) {
        throw new Error('Conéctate al router de este lote para verificar')
      }
      const users = await findUsersByComment(session.client, batch.commentTag)
      const present = users.map((u) => u.name ?? '').filter(Boolean)
      return { ok: true, present }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })
  ipcMain.handle(
    'batches:generate',
    async (e, input: { profileName: string; codeOptions: CodeOptions }) => {
      try {
        if (!session) throw new Error('No hay conexión activa')
        return await generateBatch(
          session.client,
          session.routerId,
          input.profileName,
          input.codeOptions,
          (done, total) => {
            if (!e.sender.isDestroyed()) e.sender.send('batches:generate-progress', { done, total })
          }
        )
      } catch (err) {
        return { ok: false, error: errMsg(err) }
      }
    }
  )
  ipcMain.handle('batches:resume', async (e, batchId: number) => {
    try {
      const batch = batchesRepo.getBatch(batchId)
      if (!batch) throw new Error('Lote no encontrado')
      if (!session || session.routerId !== batch.routerId) {
        throw new Error('Conéctate al router de este lote para reanudarlo')
      }
      let activeClient = session.client
      while (true) {
        try {
          return await resumeBatch(activeClient, batchId, (done, total) => {
            if (!e.sender.isDestroyed()) e.sender.send('batches:generate-progress', { done, total })
          })
        } catch (err) {
          if (!activeClient.isDisconnected?.()) throw err
          if (!e.sender.isDestroyed()) {
            e.sender.send('batches:resume-waiting-connection')
          }
          activeClient = await waitForReplacementClient(batch.routerId, activeClient)
        }
      }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })
  ipcMain.handle('batches:delete', async (_e, batchId: number) => {
    try {
      const batch = batchesRepo.getBatch(batchId)
      if (!batch) throw new Error('Lote no encontrado')
      let removed = 0
      if (session && session.routerId === batch.routerId) {
        // El comment es la fuente de verdad para encontrar los usuarios del lote
        const users = await findUsersByComment(session.client, batch.commentTag)
        const ids = users.map((u) => u['.id'] ?? '').filter(Boolean)
        removed = await removeUsers(session.client, ids)
        const usernames = batchesRepo.getVouchers(batchId).map((v) => v.username)
        await removeExpirySchedulers(session.client, usernames)
      }
      batchesRepo.deleteBatch(batchId)
      return { ok: true, removedFromRouter: removed }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })

  // ---- Plantillas ----
  ipcMain.handle('templates:list', () => templatesRepo.listTemplates(sessionRouterId()))
  ipcMain.handle('templates:create', (_e, input: TemplateInput) =>
    templatesRepo.createTemplate(sessionRouterId(), input)
  )
  ipcMain.handle('templates:update', (_e, id: number, input: TemplateInput) =>
    templatesRepo.updateTemplate(sessionRouterId(), id, input)
  )
  ipcMain.handle('templates:delete', (_e, id: number) =>
    templatesRepo.deleteTemplate(sessionRouterId(), id)
  )
  ipcMain.handle('templates:pickImage', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Elegir imagen de fondo',
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    const dir = join(app.getPath('userData'), 'templates')
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, `${Date.now()}-${basename(filePaths[0])}`)
    copyFileSync(filePaths[0], dest)
    return { path: dest, dataUrl: templatesRepo.imageToDataUrl(dest) }
  })

  // ---- Impresión ----
  ipcMain.handle('print:listPrinters', async () => {
    const win = getMainWindow()
    if (!win) return []
    return listPrinters(win)
  })
  ipcMain.handle('print:batch', async (_e, input: PrintBatchInput) => {
    try {
      const { html, printed, total, verified } = await renderBatchHtml(
        input.batchId,
        input.templateId,
        input.onlyActive ?? true
      )
      if (printed === 0) {
        return { ok: false, error: 'No hay fichas activas para imprimir', printed, total, verified }
      }
      const res = await printHtml(html, { printerName: input.printerName, silent: input.silent })
      return { ...res, printed, total, verified }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })
  ipcMain.handle(
    'print:pdf',
    async (_e, batchId: number, templateId: number, onlyActive: boolean) => {
      try {
        const { html, printed, total, verified } = await renderBatchHtml(
          batchId,
          templateId,
          onlyActive ?? true
        )
        if (printed === 0) {
          return { ok: false, error: 'No hay fichas activas para exportar', printed, total, verified }
        }
        const batch = batchesRepo.getBatch(batchId)
        // El comment_tag lleva "lote:" y los dos puntos no son válidos en nombres de archivo
        const tag = (batch?.commentTag ?? String(batchId))
          .replace('lote:', '')
          .replace(/[^a-zA-Z0-9-]/g, '-')
        const res = await exportPdf(html, `fichas-${tag}.pdf`)
        return { ...res, printed, total, verified }
      } catch (err) {
        return { ok: false, error: errMsg(err) }
      }
    }
  )
  ipcMain.handle(
    'print:previewHtml',
    async (_e, batchId: number, templateId: number, onlyActive: boolean) => {
      const { html, printed, total, verified } = await renderBatchHtml(
        batchId,
        templateId,
        onlyActive ?? true,
        true
      )
      return { html, printed, total, verified }
    }
  )

  // ---- Ajustes ----
  ipcMain.handle('settings:get', (_e, key: string) => settingsRepo.getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: string) =>
    settingsRepo.setSetting(key, value)
  )

  // ---- App Info ----
  ipcMain.handle('app:version', () => app.getVersion())
}
