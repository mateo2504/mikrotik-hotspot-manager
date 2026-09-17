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
  PppoeActiveSession,
  PppoeClient,
  PppoeClientInput,
  PppoePlan,
  PppoePlanInput,
  PreviewResult,
  PrintBatchInput,
  PrintResult,
  PrinterInfo,
  ProfileInput,
  ResumeBatchResult,
  RouterInput,
  RouterRecord,
  SimpleResult,
  Template,
  TemplateInput,
  UserInput,
  Voucher
} from './types'

// Contrato del puente preload (window.api) — compartido entre main, preload y renderer
export interface Api {
  appInfo: {
    getVersion(): Promise<string>
    onUpdateAvailable(cb: (info: { version: string }) => void): () => void
  }
  routers: {
    list(): Promise<RouterRecord[]>
    create(input: RouterInput): Promise<RouterRecord>
    update(id: number, input: RouterInput): Promise<RouterRecord>
    remove(id: number): Promise<void>
    connect(id: number): Promise<ConnectResult>
    disconnect(): Promise<SimpleResult>
    onConnectionLost(cb: (info: { error: string }) => void): () => void
  }
  profiles: {
    list(): Promise<HotspotProfile[]>
    create(input: ProfileInput): Promise<SimpleResult>
    update(rosId: string, oldName: string, input: ProfileInput): Promise<SimpleResult>
    remove(rosId: string, name: string): Promise<SimpleResult>
  }
  users: {
    list(): Promise<HotspotUser[]>
    create(input: UserInput): Promise<SimpleResult>
    update(rosId: string, input: UserInput): Promise<SimpleResult>
    remove(rosId: string): Promise<SimpleResult>
  }
  active: {
    list(): Promise<ActiveSession[]>
    disconnect(rosId: string): Promise<SimpleResult>
  }
  hosts: {
    list(): Promise<HotspotHost[]>
    convertToIpBinding(input: IpBindingInput): Promise<SimpleResult>
  }
  ipBindings: {
    list(): Promise<IpBinding[]>
    create(input: IpBindingInput): Promise<SimpleResult>
    update(rosId: string, input: IpBindingInput): Promise<SimpleResult>
    remove(rosId: string): Promise<SimpleResult>
    disable(rosId: string): Promise<SimpleResult>
    enable(rosId: string): Promise<SimpleResult>
  }
  batches: {
    list(): Promise<Batch[]>
    getVouchers(batchId: number): Promise<Voucher[]>
    checkOnRouter(batchId: number): Promise<{ ok: boolean; present?: string[]; error?: string }>
    generate(input: { profileName: string; codeOptions: CodeOptions }): Promise<GenerateBatchResult>
    resume(batchId: number): Promise<ResumeBatchResult>
    remove(batchId: number): Promise<DeleteBatchResult>
    onGenerateProgress(cb: (p: GenerateProgress) => void): () => void
    onResumeWaitingConnection(cb: () => void): () => void
  }
  templates: {
    list(): Promise<Template[]>
    create(input: TemplateInput): Promise<Template>
    update(id: number, input: TemplateInput): Promise<Template>
    remove(id: number): Promise<void>
    pickImage(): Promise<{ path: string; dataUrl: string | null } | null>
  }
  print: {
    listPrinters(): Promise<PrinterInfo[]>
    batch(input: PrintBatchInput): Promise<PrintResult>
    pdf(batchId: number, templateId: number, onlyActive: boolean): Promise<PrintResult>
    previewHtml(batchId: number, templateId: number, onlyActive: boolean): Promise<PreviewResult>
  }
  pppoePlans: {
    list(): Promise<PppoePlan[]>
    create(input: PppoePlanInput): Promise<SimpleResult>
    update(oldName: string, input: PppoePlanInput): Promise<SimpleResult>
    remove(name: string): Promise<SimpleResult>
  }
  pppoeClients: {
    list(): Promise<PppoeClient[]>
    create(input: PppoeClientInput): Promise<SimpleResult>
    update(rosId: string, previousName: string, input: PppoeClientInput): Promise<SimpleResult>
    remove(rosId: string, name: string): Promise<SimpleResult>
    suspend(rosId: string, name: string): Promise<SimpleResult>
    resume(rosId: string): Promise<SimpleResult>
  }
  pppoeActive: {
    list(): Promise<PppoeActiveSession[]>
    disconnect(rosId: string): Promise<SimpleResult>
  }
  settings: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
  }
}
