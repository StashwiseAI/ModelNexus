import Database from 'better-sqlite3'
import { DB_PATH, ensureDirs } from './paths.ts'

let _db: Database.Database | null = null

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS chats (
     id TEXT PRIMARY KEY,
     template_id TEXT,
     task TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'active',
     models_json TEXT NOT NULL,
     system_prompt TEXT,
     min_duration_minutes INTEGER NOT NULL DEFAULT 10,
     created_at INTEGER NOT NULL,
     disbanded_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS messages (
     id TEXT PRIMARY KEY,
     chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
     speaker_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     content TEXT NOT NULL,
     metadata_json TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at, id)`,
  `CREATE TABLE IF NOT EXISTS completion_signals (
     chat_id TEXT NOT NULL,
     speaker_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (chat_id, speaker_id)
   )`,
  `CREATE TABLE IF NOT EXISTS kg_nodes (
     id TEXT PRIMARY KEY,
     chat_id TEXT NOT NULL,
     type TEXT NOT NULL,
     label TEXT NOT NULL,
     props_json TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_kg_nodes_chat ON kg_nodes(chat_id)`,
  `CREATE TABLE IF NOT EXISTS kg_edges (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     chat_id TEXT NOT NULL,
     src TEXT NOT NULL,
     dst TEXT NOT NULL,
     relation TEXT NOT NULL,
     props_json TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_kg_edges_chat ON kg_edges(chat_id)`,
  `CREATE TABLE IF NOT EXISTS vec_entries (
     id TEXT PRIMARY KEY,
     chat_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     content TEXT NOT NULL,
     embedding BLOB,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_vec_chat ON vec_entries(chat_id)`,
]

const migrate = (db: Database.Database): void => {
  for (const stmt of MIGRATIONS) db.prepare(stmt).run()
}

export const getDb = (): Database.Database => {
  if (_db) return _db
  ensureDirs()
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  _db = db
  return db
}

export const closeDb = (): void => {
  if (_db) {
    _db.close()
    _db = null
  }
}
