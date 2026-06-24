# Gestor Hotspot MikroTik

Aplicación de escritorio para Windows que administra hotspots MikroTik: routers guardados, planes, usuarios, sesiones activas, lotes de fichas (vouchers) e impresión con plantillas personalizables.

## Características

- **Mis MikroTik**: lista de routers con crear, editar, eliminar y conectar. Contraseñas cifradas con DPAPI (safeStorage).
- **Conexión dual**: REST API para RouterOS v7 y API binaria (8728) para v6, con detección automática.
- **Planes**: perfiles de usuario del hotspot con velocidad (rate-limit), precio y dos tipos:
  - **Pausado**: el tiempo solo corre conectado (`limit-uptime`), con vigencia como fecha límite.
  - **Corrido**: la vigencia corre desde el primer login (script on-login con scheduler `exp-<usuario>`).
- **Usuarios**: CRUD de usuarios del hotspot.
- **Activos**: sesiones conectadas con opción de desconectar (se refresca cada 15 s).
- **Lotes**: genera N fichas con códigos aleatorios (prefijo, largo, caracteres, usuario=clave o separados). Cada usuario se etiqueta con `comment = lote:<id>` para poder reimprimir o eliminar el lote completo después.
- **Plantillas**: editor de fichas con imagen de fondo, campos activables (tamaño, negrita, alineación) y vista previa en vivo. Formatos: hoja A4/Carta en cuadrícula e impresora térmica 58/80 mm.
- **Impresión**: diálogo de Windows, impresión rápida silenciosa o exportar a PDF.

## Requisitos del router

- **RouterOS v7**: servicio `www` o `www-ssl` habilitado (`/ip service`) para REST; si no, cae a la API binaria (`api`, puerto 8728).
- **RouterOS v6**: servicio `api` habilitado (puerto 8728).
- Usuario con permisos de lectura/escritura (grupo `full` recomendado para que el script de vigencia pueda crear schedulers).

## Desarrollo

```bash
npm install        # instala dependencias y recompila módulos nativos para Electron
npm run dev        # arranca en modo desarrollo con HMR
npm run typecheck  # verificación de tipos
npm run build:win  # genera el instalador NSIS en dist/
```

## Estructura

- `src/main/` — proceso principal: SQLite (better-sqlite3), clientes RouterOS (REST + binario), impresión, IPC.
- `src/preload/` — puente `window.api` tipado (contextBridge).
- `src/renderer/` — interfaz React (pantallas: routers, dashboard, planes, usuarios, activos, lotes, plantillas).
- `src/shared/` — tipos compartidos y el renderizador HTML de fichas (`voucherRender.ts`), usado por la vista previa y la impresión.

Los datos locales (routers, lotes, plantillas) viven en `%APPDATA%/gestor-hotspot-mikrotik/hotspot.db`.
