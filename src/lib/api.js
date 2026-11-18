// Cliente HTTP da API.
const TOKEN_KEY = 'jc_token';

export function getAuthToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

async function request(method, url, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    setAuthToken('');
    window.dispatchEvent(new Event('jc:unauthorized'));
  }
  if (res.status === 413) {
    throw new Error('O arquivo enviado excede o limite de 4,5 MB por envio direto. Dica: cole a URL pública do edital em PDF que o servidor baixa arquivos de até 40 MB automaticamente.');
  }
  if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
  return data;
}

async function requestBinary(url, file, extraHeaders = {}) {
  const headers = {
    'Content-Type': file.type || 'application/octet-stream',
    ...extraHeaders,
  };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { method: 'POST', credentials: 'include', headers, body: file });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (res.status === 401) {
    setAuthToken('');
    window.dispatchEvent(new Event('jc:unauthorized'));
  }
  if (res.status === 413) {
    throw new Error('O arquivo enviado excede o limite de 4,5 MB da plataforma. Dica: cole a URL do PDF do edital no campo abaixo para analisarmos arquivos de até 40 MB.');
  }
  if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
  return data;
}

async function pollUntilDone(checkFn, maxMs = 10 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, 2500));
    const r = await checkFn();
    if (r?.status === 'completed') return r;
  }
  throw new Error('Tempo limite excedido aguardando a leitura pela IA. Tente novamente.');
}

export const api = {
  // Autenticação
  me: () => request('GET', '/api/auth/me'),
  login: async (payload) => {
    const r = await request('POST', '/api/auth/login', payload);
    if (r?.token) setAuthToken(r.token);
    return r;
  },
  register: async (payload) => {
    const r = await request('POST', '/api/auth/register', payload);
    if (r?.token) setAuthToken(r.token);
    return r;
  },
  logout: async () => {
    setAuthToken('');
    await request('POST', '/api/auth/logout');
  },

  // Concursos
  listConcursos: () => request('GET', '/api/concursos'),
  getConcurso: (id) => request('GET', `/api/concursos/${id}`),
  createConcurso: (data) => request('POST', '/api/concursos', data),
  updateConcurso: (id, data) => request('PUT', `/api/concursos/${id}`, data),
  deleteConcurso: (id) => request('DELETE', `/api/concursos/${id}`),
  verificar: (id) => request('POST', `/api/concursos/${id}/verificar`),
  setMonitor: (id, data) => request('PUT', `/api/concursos/${id}/monitor`, data),
  runMonitor: () => request('POST', '/api/monitor/executar'),
  notificacoes: () => request('GET', '/api/notificacoes'),
  marcarLidas: (ids) => request('POST', '/api/notificacoes/lidas', { ids }),
  excluirNotificacao: (id) => request('DELETE', `/api/notificacoes/${id}`),
  extrair: async (payload) => {
    const start = await request('POST', '/api/ia/extrair', payload);
    if (start?.status === 'completed' || start?.data) return start;
    return pollUntilDone(() => request('POST', `/api/ia/status/${encodeURIComponent(start.jobId)}`, { url: start.url || payload.url || '', fontes: start.fontes || [] }));
  },
  extrairArquivo: async (file, url = '') => {
    const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain');
    const headers = { 'X-File-Mime': encodeURIComponent(mime) };
    if (url) headers['X-Concurso-Url'] = encodeURIComponent(url);
    const start = await requestBinary('/api/ia/extrair-arquivo', file, headers);
    if (start?.status === 'completed' || start?.data) return start;
    return pollUntilDone(() => request('POST', `/api/ia/status/${encodeURIComponent(start.jobId)}`, { url: start.url || url || '', fontes: start.fontes || [] }));
  },
  extrairGabarito: async (payload) => {
    const start = await request('POST', '/api/ia/extrair-gabarito', payload);
    if (start?.status === 'completed' || start?.respostas) return start;
    const { fileBase64, ...meta } = payload;
    return pollUntilDone(() => request('POST', `/api/ia/gabarito-status/${encodeURIComponent(start.jobId)}`, meta));
  },
  testarIa: (provider) => request('POST', '/api/ia/testar', provider ? { provider } : {}),
  getConfig: () => request('GET', '/api/config'),
  saveConfig: (data) => request('PUT', '/api/config', data),
  importBackup: (data) => request('POST', '/api/backup', data),
};

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}
