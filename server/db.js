// Armazenamento local simples em arquivo JSON (sem dependências nativas).
// Escritas são atômicas (arquivo temporário + rename) e serializadas.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_DATA_DIR = process.env.VERCEL ? '/tmp/jornada-data' : path.resolve(process.cwd(), 'data');
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = { concursos: [], notificacoes: [], settings: {} };

let state = null;
let writeChain = Promise.resolve();

function load() {
  if (state) return state;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      state = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
    } catch (err) {
      const backup = `${DB_FILE}.corrompido-${Date.now()}`;
      fs.copyFileSync(DB_FILE, backup);
      console.error(`[db] Arquivo corrompido. Backup salvo em ${backup}`);
      state = structuredClone(EMPTY);
    }
  } else {
    state = structuredClone(EMPTY);
  }
  return state;
}

function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  writeChain = writeChain.then(async () => {
    const tmp = `${DB_FILE}.tmp`;
    await fs.promises.writeFile(tmp, snapshot, 'utf8');
    await fs.promises.rename(tmp, DB_FILE);
  }).catch((err) => console.error('[db] Falha ao salvar:', err));
  return writeChain;
}

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export const db = {
  // ---------- Concursos ----------
  listConcursos() {
    return load().concursos;
  },
  getConcurso(id) {
    return load().concursos.find((c) => c.id === id) || null;
  },
  async createConcurso(data) {
    const c = { ...data, id: uid(), createdAt: now(), updatedAt: now() };
    c.provas = (c.provas || []).map((p) => ({ ...p, id: p.id || uid() }));
    load().concursos.unshift(c);
    await persist();
    return c;
  },
  async updateConcurso(id, patch) {
    const list = load().concursos;
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    const merged = { ...list[idx], ...patch, id, updatedAt: now() };
    if (merged.provas) merged.provas = merged.provas.map((p) => ({ ...p, id: p.id || uid() }));
    list[idx] = merged;
    await persist();
    return merged;
  },
  async deleteConcurso(id) {
    const s = load();
    const before = s.concursos.length;
    s.concursos = s.concursos.filter((c) => c.id !== id);
    s.notificacoes = s.notificacoes.filter((n) => n.concursoId !== id);
    await persist();
    return s.concursos.length < before;
  },

  // ---------- Notificações ----------
  listNotificacoes() {
    return load().notificacoes;
  },
  async addNotificacao(n) {
    const item = { id: uid(), lida: false, createdAt: now(), ...n };
    const s = load();
    s.notificacoes.unshift(item);
    s.notificacoes = s.notificacoes.slice(0, 300);
    await persist();
    return item;
  },
  async markNotificacoes(ids, lida = true) {
    const set = ids ? new Set(ids) : null;
    for (const n of load().notificacoes) if (!set || set.has(n.id)) n.lida = lida;
    await persist();
  },
  async deleteNotificacao(id) {
    const s = load();
    s.notificacoes = s.notificacoes.filter((n) => n.id !== id);
    await persist();
  },

  // ---------- Configurações ----------
  getSettings() {
    return load().settings || {};
  },
  async updateSettings(patch) {
    const s = load();
    s.settings = { ...s.settings, ...patch };
    await persist();
    return s.settings;
  },
};
