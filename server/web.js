// Utilitários HTTP/HTML usados pela IA e pelo monitor de páginas.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 JornadaDoConcurseiro/1.0';

export async function fetchPage(url, { timeoutMs = 30000, maxBytes = 10 * 1024 * 1024 } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw Object.assign(new Error('URL inválida.'), { status: 400 });
  }
  if (!/^https?:$/.test(parsed.protocol)) throw Object.assign(new Error('Apenas URLs http(s) são suportadas.'), { status: 400 });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(parsed, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9' },
    });
    if (!res.ok) throw new Error(`A página respondeu com HTTP ${res.status}.`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > maxBytes) throw new Error('Arquivo muito grande para ser processado.');
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('Arquivo muito grande para ser processado.');
    const contentType = res.headers.get('content-type') || '';
    const isPdf = /pdf/i.test(contentType) || buffer.subarray(0, 5).toString() === '%PDF-';
    return {
      status: res.status,
      finalUrl: res.url || parsed.href,
      contentType,
      isPdf,
      buffer,
      body: isPdf ? '' : decode(buffer, contentType),
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Tempo esgotado ao acessar a página.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function decode(buffer, contentType) {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  const head = buffer.subarray(0, 4096).toString('latin1');
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const charset = (fromHeader || fromMeta || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ordm: 'º', ordf: 'ª', ccedil: 'ç', atilde: 'ã', otilde: 'õ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', Ccedil: 'Ç', Atilde: 'Ã', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú' };

export function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m);
}

/** Converte HTML em texto legível, uma linha por bloco. */
export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/table|\/ul|\/ol)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Extrai links (href absoluto + texto) de um HTML. */
export function extractLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let href;
    try {
      href = new URL(decodeEntities(m[1].trim()), baseUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(href) || seen.has(href)) continue;
    seen.add(href);
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    out.push({ href, text: text || href.split('/').pop() });
  }
  return out;
}
