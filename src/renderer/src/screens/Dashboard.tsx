import type { Connection, Screen } from '../App'

const HOTSPOT_MENU: {
  screen: Screen
  icon: string
  color: string
  title: string
  desc: string
}[] = [
  {
    screen: 'planes',
    icon: '📋',
    color: 'rgba(47, 129, 247, 0.15)',
    title: 'Planes',
    desc: 'Perfiles de usuario: velocidad, vigencia, tipo pausado o corrido y precio.'
  },
  {
    screen: 'usuarios',
    icon: '👤',
    color: 'rgba(63, 185, 80, 0.15)',
    title: 'Usuarios',
    desc: 'Usuarios del hotspot: crear, editar y eliminar.'
  },
  {
    screen: 'activos',
    icon: '🟢',
    color: 'rgba(210, 153, 34, 0.15)',
    title: 'Activos',
    desc: 'Sesiones conectadas en este momento, con opción de desconectar.'
  },
  {
    screen: 'hosts',
    icon: '🖥️',
    color: 'rgba(139, 148, 158, 0.15)',
    title: 'Hosts',
    desc: 'Dispositivos conectados al hotspot. Convertir a IP Binding (bypass).'
  },
  {
    screen: 'ipBindings',
    icon: '🔗',
    color: 'rgba(210, 153, 34, 0.15)',
    title: 'IP Binding',
    desc: 'Dispositivos con bypass/bloqueo manual. VIP o con tiempo de expiración.'
  },
  {
    screen: 'lotes',
    icon: '🎟️',
    color: 'rgba(124, 77, 255, 0.15)',
    title: 'Lotes',
    desc: 'Generar fichas en lote, reimprimirlas o eliminarlas.'
  },
  {
    screen: 'plantillas',
    icon: '🖨️',
    color: 'rgba(248, 81, 73, 0.15)',
    title: 'Plantillas',
    desc: 'Diseño de las fichas para imprimir, con imagen de fondo.'
  }
]

const PPPOE_MENU: {
  screen: Screen
  icon: string
  color: string
  title: string
  desc: string
}[] = [
  {
    screen: 'pppoePlanes',
    icon: '📡',
    color: 'rgba(47, 129, 247, 0.15)',
    title: 'Planes PPPoE',
    desc: 'Megas de subida y bajada. La velocidad se aplica con simplequeue.'
  },
  {
    screen: 'pppoeClientes',
    icon: '👥',
    color: 'rgba(63, 185, 80, 0.15)',
    title: 'Clientes PPPoE',
    desc: 'Secrets PPPoE: crear, editar, eliminar y suspender.'
  },
  {
    screen: 'pppoeActivos',
    icon: '🔌',
    color: 'rgba(210, 153, 34, 0.15)',
    title: 'Activos PPPoE',
    desc: 'Sesiones PPPoE conectadas. Solo desconectar.'
  }
]

function MenuGrid({
  items,
  onNavigate
}: {
  items: typeof HOTSPOT_MENU
  onNavigate: (s: Screen) => void
}): React.JSX.Element {
  return (
    <div className="menu-grid">
      {items.map((m) => (
        <div key={m.screen} className="menu-card" onClick={() => onNavigate(m.screen)}>
          <div className="mc-icon" style={{ background: m.color }}>
            {m.icon}
          </div>
          <div className="mc-body">
            <h3>{m.title}</h3>
            <p>{m.desc}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard({
  connection,
  onNavigate,
  onExit
}: {
  connection: Connection
  onNavigate: (s: Screen) => void
  onExit: () => void
}): React.JSX.Element {
  return (
    <div>
      <div className="screen-head">
        <button className="btn" onClick={onExit}>
          ← Cambiar de router
        </button>
        <h1>{connection.router.name}</h1>
      </div>
      <h2 className="menu-section">Hotspot</h2>
      <MenuGrid items={HOTSPOT_MENU} onNavigate={onNavigate} />
      <h2 className="menu-section">PPPoE</h2>
      <MenuGrid items={PPPOE_MENU} onNavigate={onNavigate} />
    </div>
  )
}
