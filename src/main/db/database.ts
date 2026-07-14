import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database | null = null

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE routers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER,
    username TEXT NOT NULL,
    password_enc BLOB NOT NULL,
    use_ssl INTEGER NOT NULL DEFAULT 0,
    api_type TEXT NOT NULL DEFAULT 'auto' CHECK(api_type IN ('auto','rest','binary')),
    detected_api TEXT CHECK(detected_api IN ('rest','binary')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE plan_meta (
    profile_name TEXT PRIMARY KEY,
    price TEXT NOT NULL DEFAULT '',
    plan_type TEXT NOT NULL DEFAULT 'pausado' CHECK(plan_type IN ('pausado','corrido')),
    validity TEXT NOT NULL DEFAULT '',
    uptime_limit TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    profile_name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    prefix TEXT NOT NULL DEFAULT '',
    code_options_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    comment_tag TEXT NOT NULL
  );
  CREATE TABLE vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    created_on_router INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_vouchers_batch ON vouchers(batch_id);
  CREATE TABLE templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('a4','thermal')),
    config_json TEXT NOT NULL,
    bg_image_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2: agregar hotspot_host para QR del portal
  `
  ALTER TABLE routers ADD COLUMN hotspot_host TEXT;
  `,
  // v3: opción de MAC aleatoria por plan
  `
  ALTER TABLE plan_meta ADD COLUMN mac_aleatoria INTEGER NOT NULL DEFAULT 0;
  `,
  // v4: planes y plantillas independientes por router
  `
  CREATE TABLE plan_meta_new (
    router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    profile_name TEXT NOT NULL,
    price TEXT NOT NULL DEFAULT '',
    plan_type TEXT NOT NULL DEFAULT 'pausado' CHECK(plan_type IN ('pausado','corrido')),
    validity TEXT NOT NULL DEFAULT '',
    uptime_limit TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    mac_aleatoria INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (router_id, profile_name)
  );
  INSERT INTO plan_meta_new (router_id, profile_name, price, plan_type, validity, uptime_limit, notes, mac_aleatoria)
    SELECT r.id, p.profile_name, p.price, p.plan_type, p.validity, p.uptime_limit, p.notes, p.mac_aleatoria
    FROM routers r CROSS JOIN plan_meta p;
  DROP TABLE plan_meta;
  ALTER TABLE plan_meta_new RENAME TO plan_meta;
  CREATE INDEX idx_plan_meta_router ON plan_meta(router_id);

  CREATE TABLE templates_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('a4','thermal')),
    config_json TEXT NOT NULL,
    bg_image_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO templates_new (router_id, name, kind, config_json, bg_image_path, created_at)
    SELECT r.id, t.name, t.kind, t.config_json, t.bg_image_path, t.created_at
    FROM routers r CROSS JOIN templates t;
  DROP TABLE templates;
  ALTER TABLE templates_new RENAME TO templates;
  CREATE INDEX idx_templates_router ON templates(router_id);
  DELETE FROM settings WHERE key = 'lastTemplateId';
  `
]

export function getDb(): Database.Database {
  if (db) return db
  const dbPath = join(app.getPath('userData'), 'hotspot.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(d: Database.Database): void {
  const current = d.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    d.transaction(() => {
      d.exec(MIGRATIONS[v])
      d.pragma(`user_version = ${v + 1}`)
    })()
  }
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
