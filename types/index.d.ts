export type Desk = {
  id: string
  title: string
  project: string
  isRunning: boolean
  isSelf: boolean
  link?: string
  pr?: string
  lastActivityAt?: string
  group?: string
}

export type Office = {
  desks: Desk[]
  updatedAt: number
  error?: string
}

export type View = {
  filter: string
  themes: Record<string, number>
  notify: boolean
  confirming?: { id: string; action: 'archive' | 'stop' | 'delete' }
}

declare module 'claude-code' {
  interface PluginState {
    'oficina-agentes': { office: Shaped<Office>; view: Shaped<View> }
  }
}
