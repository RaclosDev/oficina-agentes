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
  pinned?: boolean
  /** Abierta en la ventana de la app (en algún panel) y si es la que tiene el foco. */
  onScreen?: boolean
  focused?: boolean
  /** Lo último que hizo: una herramienta (la página la traduce) o su último texto. */
  activity?: Activity
}

export type Activity = { kind: 'tool'; tool: string } | { kind: 'text'; text: string }

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
