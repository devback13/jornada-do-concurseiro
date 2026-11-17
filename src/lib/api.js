// Cliente HTTP da API.
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
  return data;
}

export const api = {
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
  extrair: (payload) => request('POST', '/api/ia/extrair', payload),
  extrairGabarito: (payload) => request('POST', '/api/ia/extrair-gabarito', payload),
  testarIa: () => request('POST', '/api/ia/testar'),
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
