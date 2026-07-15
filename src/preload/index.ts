import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/api'
import type {
  ActiveSession,
  Batch,
  CodeOptions,
  ConnectResult,
  DeleteBatchResult,
  GenerateBatchResult,
  GenerateProgress,
  HotspotHost,
  HotspotProfile,
  HotspotUser,
  IpBinding,
  IpBindingInput,
  PreviewResult,
  PrintBatchInput,
  PrintResult,
  PrinterInfo,
  ProfileInput,
  RouterInput,
  RouterRecord,
  SimpleResult,
  Template,
  TemplateInput,
  UserInput,
  Voucher
} from '../shared/types'

const api: Api = {
  appInfo: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
    onUpdateAvailable: (cb: (info: { version: string }) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, info: { version: string }): void => cb(info)
      ipcRenderer.on('app:update-available', listener)
      return () => ipcRenderer.removeListener('app:update-available', listener)
    }
  },
  routers: {
    list: (): Promise<RouterRecord[]> => ipcRenderer.invoke('routers:list'),
    create: (input: RouterInput): Promise<RouterRecord> =>
      ipcRenderer.invoke('routers:create', input),
    update: (id: number, input: RouterInput): Promise<RouterRecord> =>
      ipcRenderer.invoke('routers:update', id, input),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('routers:delete', id),
    connect: (id: number): Promise<ConnectResult> => ipcRenderer.invoke('router:connect', id),
    disconnect: (): Promise<SimpleResult> => ipcRenderer.invoke('router:disconnect'),
    onConnectionLost: (cb: (info: { error: string }) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, info: { error: string }): void => cb(info)
      ipcRenderer.on('router:connection-lost', listener)
      return () => ipcRenderer.removeListener('router:connection-lost', listener)
    }
  },
  profiles: {
    list: (): Promise<HotspotProfile[]> => ipcRenderer.invoke('profiles:list'),
    create: (input: ProfileInput): Promise<SimpleResult> =>
      ipcRenderer.invoke('profiles:create', input),
    update: (rosId: string, oldName: string, input: ProfileInput): Promise<SimpleResult> =>
      ipcRenderer.invoke('profiles:update', rosId, oldName, input),
    remove: (rosId: string, name: string): Promise<SimpleResult> =>
      ipcRenderer.invoke('profiles:delete', rosId, name)
  },
  users: {
    list: (): Promise<HotspotUser[]> => ipcRenderer.invoke('users:list'),
    create: (input: UserInput): Promise<SimpleResult> => ipcRenderer.invoke('users:create', input),
    update: (rosId: string, input: UserInput): Promise<SimpleResult> =>
      ipcRenderer.invoke('users:update', rosId, input),
    remove: (rosId: string): Promise<SimpleResult> => ipcRenderer.invoke('users:delete', rosId)
  },
  active: {
    list: (): Promise<ActiveSession[]> => ipcRenderer.invoke('active:list'),
    disconnect: (rosId: string): Promise<SimpleResult> =>
      ipcRenderer.invoke('active:disconnect', rosId)
  },
  hosts: {
    list: (): Promise<HotspotHost[]> => ipcRenderer.invoke('hosts:list'),
    convertToIpBinding: (input: IpBindingInput): Promise<SimpleResult> =>
      ipcRenderer.invoke('hosts:convertToIpBinding', input)
  },
  ipBindings: {
    list: (): Promise<IpBinding[]> => ipcRenderer.invoke('ipBindings:list'),
    create: (input: IpBindingInput): Promise<SimpleResult> =>
      ipcRenderer.invoke('ipBindings:create', input),
    update: (rosId: string, input: IpBindingInput): Promise<SimpleResult> =>
      ipcRenderer.invoke('ipBindings:update', rosId, input),
    remove: (rosId: string): Promise<SimpleResult> =>
      ipcRenderer.invoke('ipBindings:delete', rosId),
    disable: (rosId: string): Promise<SimpleResult> =>
      ipcRenderer.invoke('ipBindings:disable', rosId),
    enable: (rosId: string): Promise<SimpleResult> =>
      ipcRenderer.invoke('ipBindings:enable', rosId)
  },
  batches: {
    list: (): Promise<Batch[]> => ipcRenderer.invoke('batches:list'),
    getVouchers: (batchId: number): Promise<Voucher[]> =>
      ipcRenderer.invoke('batches:getVouchers', batchId),
    checkOnRouter: (
      batchId: number
    ): Promise<{ ok: boolean; present?: string[]; error?: string }> =>
      ipcRenderer.invoke('batches:checkOnRouter', batchId),
    generate: (input: { profileName: string; codeOptions: CodeOptions }): Promise<GenerateBatchResult> =>
      ipcRenderer.invoke('batches:generate', input),
    remove: (batchId: number): Promise<DeleteBatchResult> =>
      ipcRenderer.invoke('batches:delete', batchId),
    onGenerateProgress: (cb: (p: GenerateProgress) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, p: GenerateProgress): void => cb(p)
      ipcRenderer.on('batches:generate-progress', listener)
      return () => ipcRenderer.removeListener('batches:generate-progress', listener)
    }
  },
  templates: {
    list: (): Promise<Template[]> => ipcRenderer.invoke('templates:list'),
    create: (input: TemplateInput): Promise<Template> => ipcRenderer.invoke('templates:create', input),
    update: (id: number, input: TemplateInput): Promise<Template> =>
      ipcRenderer.invoke('templates:update', id, input),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('templates:delete', id),
    pickImage: (): Promise<{ path: string; dataUrl: string | null } | null> =>
      ipcRenderer.invoke('templates:pickImage')
  },
  print: {
    listPrinters: (): Promise<PrinterInfo[]> => ipcRenderer.invoke('print:listPrinters'),
    batch: (input: PrintBatchInput): Promise<PrintResult> =>
      ipcRenderer.invoke('print:batch', input),
    pdf: (batchId: number, templateId: number, onlyActive: boolean): Promise<PrintResult> =>
      ipcRenderer.invoke('print:pdf', batchId, templateId, onlyActive),
    previewHtml: (batchId: number, templateId: number, onlyActive: boolean): Promise<PreviewResult> =>
      ipcRenderer.invoke('print:previewHtml', batchId, templateId, onlyActive)
  },
  settings: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke('settings:set', key, value)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
