// Camada de persistência com suporte nativo ao Neon Postgres (@neondatabase/serverless)
// e fallback local em arquivo JSON quando DATABASE_URL não estiver definido.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { notifyUserTelegram } from './telegram.js';

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Cliente Neon Postgres (lazy initialization)
// ---------------------------------------------------------------------------
let _sql = null;
let _schemaReady = null;

export function isPostgresConfigured() {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL não configurada.');
    _sql = neon(url);
  }
  return _sql;
}

export async function ensureSchema() {
  if (!isPostgresConfigured()) return false;
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    const sql = getSql();
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        sobrenome TEXT DEFAULT '',
        email TEXT UNIQUE NOT NULL,
        telefone TEXT DEFAULT '',
        password_hash TEXT NOT NULL,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS telefone TEXT DEFAULT ''`;
    await sql`
      CREATE TABLE IF NOT EXISTS concursos (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_concursos_user_created ON concursos(user_id, created_at DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS notificacoes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        concurso_id TEXT,
        lida BOOLEAN NOT NULL DEFAULT FALSE,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_notificacoes_user_created ON notificacoes(user_id, created_at DESC)`;
    return true;
  })().catch((err) => {
    _schemaReady = null;
    throw err;
  });
  return _schemaReady;
}

// ---------------------------------------------------------------------------
// Fallback local em JSON (usado somente quando DATABASE_URL não está definida)
// ---------------------------------------------------------------------------
const DEFAULT_DATA_DIR = process.env.VERCEL ? '/tmp/jornada-data' : path.resolve(process.cwd(), 'data');
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const EMPTY_LOCAL = { users: [], concursos: [], notificacoes: [], settings: {} };

let localState = null;
let writeChain = Promise.resolve();

function loadLocal() {
  if (localState) return localState;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      localState = { ...structuredClone(EMPTY_LOCAL), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
      if (!Array.isArray(localState.users)) localState.users = [];
    } catch {
      localState = structuredClone(EMPTY_LOCAL);
    }
  } else {
    localState = structuredClone(EMPTY_LOCAL);
  }
  return localState;
}

function persistLocal() {
  const snapshot = JSON.stringify(localState, null, 2);
  writeChain = writeChain.then(async () => {
    const tmp = `${DB_FILE}.tmp`;
    await fs.promises.writeFile(tmp, snapshot, 'utf8');
    await fs.promises.rename(tmp, DB_FILE);
  }).catch((err) => console.error('[db] Falha ao salvar localmente:', err));
  return writeChain;
}

function formatUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    sobrenome: row.sobrenome || '',
    email: row.email,
    telefone: row.telefone || '',
    passwordHash: row.password_hash ?? row.passwordHash,
    settings: row.settings || {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// API unificada do banco (todas as operações de concurso/notificação são isoladas por userId)
// ---------------------------------------------------------------------------
export const db = {
  // ---------- Usuários ----------
  async createUser({ nome, sobrenome = '', email, telefone = '', passwordHash }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPhone = String(telefone || '').trim();
    const id = uid();
    const createdAt = now();

    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      const rows = await sql`
        INSERT INTO users (id, nome, sobrenome, email, telefone, password_hash, settings, created_at, updated_at)
        VALUES (${id}, ${nome.trim()}, ${sobrenome.trim()}, ${cleanEmail}, ${cleanPhone}, ${passwordHash}, '{}'::jsonb, ${createdAt}, ${createdAt})
        RETURNING *
      `;
      return formatUserRow(rows[0]);
    }

    const s = loadLocal();
    if (s.users.some((u) => u.email === cleanEmail)) {
      const err = new Error('Já existe uma conta cadastrada com este e-mail.');
      err.status = 409;
      throw err;
    }
    const user = {
      id,
      nome: nome.trim(),
      sobrenome: sobrenome.trim(),
      email: cleanEmail,
      telefone: cleanPhone,
      passwordHash,
      settings: {},
      createdAt,
    };
    s.users.push(user);
    await persistLocal();
    return user;
  },

  async updateUser(id, { nome, sobrenome, email, telefone, passwordHash }) {
    const current = await this.getUserById(id);
    if (!current) return null;

    const nextNome = nome !== undefined ? String(nome).trim() : current.nome;
    const nextSobrenome = sobrenome !== undefined ? String(sobrenome).trim() : (current.sobrenome || '');
    const nextEmail = email !== undefined ? String(email).trim().toLowerCase() : current.email;
    const nextTelefone = telefone !== undefined ? String(telefone).trim() : (current.telefone || '');
    const nextPasswordHash = passwordHash || current.passwordHash;
    const ts = now();

    if (nextEmail !== current.email) {
      const other = await this.getUserByEmail(nextEmail);
      if (other && other.id !== id) {
        const err = new Error('Este e-mail já está em uso por outra conta.');
        err.status = 409;
        throw err;
      }
    }

    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      const rows = await sql`
        UPDATE users
        SET nome = ${nextNome},
            sobrenome = ${nextSobrenome},
            email = ${nextEmail},
            telefone = ${nextTelefone},
            password_hash = ${nextPasswordHash},
            updated_at = ${ts}
        WHERE id = ${id}
        RETURNING *
      `;
      return formatUserRow(rows[0]);
    }

    const s = loadLocal();
    const idx = s.users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    s.users[idx] = {
      ...s.users[idx],
      nome: nextNome,
      sobrenome: nextSobrenome,
      email: nextEmail,
      telefone: nextTelefone,
      passwordHash: nextPasswordHash,
      updatedAt: ts,
    };
    await persistLocal();
    return s.users[idx];
  },

  async getUserByEmail(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) return null;
    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      const rows = await sql`SELECT * FROM users WHERE email = ${cleanEmail} LIMIT 1`;
      return formatUserRow(rows[0]);
    }
    return loadLocal().users.find((u) => u.email === cleanEmail) || null;
  },

  async getUserById(id) {
    if (!id) return null;
    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      const rows = await sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
      return formatUserRow(rows[0]);
    }
    return loadLocal().users.find((u) => u.id === id) || null;
  },

  // ---------- Concursos (isolados por userId) ----------
  async listConcursos(userId) {
    if (!userId) return [];
    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      const rows = await sql`
        SELECT data FROM concursos
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;
      return rows.map((r) => ({ ...r.data, userId }));
    }
    return loadLocal().concursos.filter((c) => c.userId === userId);
  },

  async listAllConcursosForMonitor() {
    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      const rows = await sql`SELECT user_id, data FROM concursos ORDER BY created_at DESC`;
      return rows.map((r) => ({ ...r.data, userId: r.user_id }));
    }
    return loadLocal().concursos;
  },

  async getConcurso(userId, id) {
    if (!id) return null;
    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      const rows = userId
        ? await sql`SELECT user_id, data FROM concursos WHERE id = ${id} AND user_id = ${userId} LIMIT 1`
        : await sql`SELECT user_id, data FROM concursos WHERE id = ${id} LIMIT 1`;
      if (!rows[0]) return null;
      return { ...rows[0].data, userId: rows[0].user_id };
    }
    const c = loadLocal().concursos.find((x) => x.id === id && (!userId || x.userId === userId));
    return c || null;
  },

  async createConcurso(userId, data) {
    const id = uid();
    const ts = now();
    const c = {
      ...data,
      id,
      userId,
      provas: (data.provas || []).map((p) => ({ ...p, id: p.id || uid() })),
      createdAt: ts,
      updatedAt: ts,
    };

    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      await sql`
        INSERT INTO concursos (id, user_id, data, created_at, updated_at)
        VALUES (${id}, ${userId}, ${JSON.stringify(c)}::jsonb, ${ts}, ${ts})
      `;
      return c;
    }

    loadLocal().concursos.unshift(c);
    await persistLocal();
    return c;
  },

  async updateConcurso(userId, id, patch) {
    const current = await this.getConcurso(userId, id);
    if (!current) return null;
    const ownerId = userId || current.userId;
    const ts = now();
    const merged = { ...current, ...patch, id, userId: ownerId, updatedAt: ts };
    if (merged.provas) merged.provas = merged.provas.map((p) => ({ ...p, id: p.id || uid() }));

    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      await sql`
        UPDATE concursos
        SET data = ${JSON.stringify(merged)}::jsonb, updated_at = ${ts}
        WHERE id = ${id} AND user_id = ${ownerId}
      `;
      return merged;
    }

    const list = loadLocal().concursos;
    const idx = list.findIndex((c) => c.id === id && c.userId === ownerId);
    if (idx === -1) return null;
    list[idx] = merged;
    await persistLocal();
    return merged;
  },

  async deleteConcurso(userId, id) {
    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      await sql`DELETE FROM notificacoes WHERE concurso_id = ${id} AND user_id = ${userId}`;
      const rows = await sql`DELETE FROM concursos WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
      return rows.length > 0;
    }

    const s = loadLocal();
    const before = s.concursos.length;
    s.concursos = s.concursos.filter((c) => !(c.id === id && c.userId === userId));
    s.notificacoes = s.notificacoes.filter((n) => !(n.concursoId === id && n.userId === userId));
    await persistLocal();
    return s.concursos.length < before;
  },

  // ---------- Notificações (isoladas por userId) ----------
  async listNotificacoes(userId) {
    if (!userId) return [];
    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      const rows = await sql`
        SELECT data, lida FROM notificacoes
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 100
      `;
      return rows.map((r) => ({ ...r.data, lida: r.lida }));
    }
    return loadLocal().notificacoes.filter((n) => n.userId === userId).slice(0, 100);
  },

  async addNotificacao(userId, n) {
    if (!userId) return null;
    const id = uid();
    const createdAt = now();
    const item = { id, userId, lida: false, createdAt, ...n };

    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      await sql`
        INSERT INTO notificacoes (id, user_id, concurso_id, lida, data, created_at)
        VALUES (${id}, ${userId}, ${item.concursoId || null}, ${Boolean(item.lida)}, ${JSON.stringify(item)}::jsonb, ${createdAt})
      `;
      await notifyUserTelegram(this, userId, item);
      return item;
    }

    const s = loadLocal();
    s.notificacoes.unshift(item);
    s.notificacoes = s.notificacoes.slice(0, 500);
    await persistLocal();
    await notifyUserTelegram(this, userId, item);
    return item;
  },

  async markNotificacoes(userId, ids, lida = true) {
    if (!userId) return;
    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      if (Array.isArray(ids) && ids.length) {
        await sql`
          UPDATE notificacoes
          SET lida = ${lida}, data = jsonb_set(data, '{lida}', ${lida ? 'true' : 'false'}::jsonb)
          WHERE user_id = ${userId} AND id = ANY(${ids})
        `;
      } else {
        await sql`
          UPDATE notificacoes
          SET lida = ${lida}, data = jsonb_set(data, '{lida}', ${lida ? 'true' : 'false'}::jsonb)
          WHERE user_id = ${userId}
        `;
      }
      return;
    }

    const set = ids ? new Set(ids) : null;
    for (const n of loadLocal().notificacoes) {
      if (n.userId === userId && (!set || set.has(n.id))) n.lida = lida;
    }
    await persistLocal();
  },

  async deleteNotificacao(userId, id) {
    if (!userId) return;
    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      await sql`DELETE FROM notificacoes WHERE id = ${id} AND user_id = ${userId}`;
      return;
    }
    const s = loadLocal();
    s.notificacoes = s.notificacoes.filter((n) => !(n.id === id && n.userId === userId));
    await persistLocal();
  },

  // ---------- Configurações (por usuário) ----------
  async getSettings(userId) {
    if (!userId) return isPostgresConfigured() ? {} : (loadLocal().settings || {});
    const user = await this.getUserById(userId);
    return user?.settings || {};
  },

  async updateSettings(userId, patch) {
    if (!userId) {
      if (isPostgresConfigured()) return patch;
      const s = loadLocal();
      s.settings = { ...s.settings, ...patch };
      await persistLocal();
      return s.settings;
    }

    const current = await this.getSettings(userId);
    const merged = { ...current, ...patch };

    if (isPostgresConfigured()) {
      await ensureSchema();
      const sql = getSql();
      await sql`
        UPDATE users
        SET settings = ${JSON.stringify(merged)}::jsonb, updated_at = ${now()}
        WHERE id = ${userId}
      `;
      return merged;
    }

    const s = loadLocal();
    const u = s.users.find((x) => x.id === userId);
    if (u) {
      u.settings = merged;
      await persistLocal();
    }
    return merged;
  },
};
