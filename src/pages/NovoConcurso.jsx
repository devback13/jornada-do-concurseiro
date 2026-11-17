import { useEffect, useRef, useState } from 'react';
import { Sparkles, PenLine, UploadCloud, Link2, FileText, X, ArrowLeft, Wand2, AlertCircle, CheckCircle2, Settings, Type, ChevronDown } from 'lucide-react';
import { api, fileToBase64 } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { useConfig } from '../lib/configContext.js';
import ConcursoForm, { EMPTY_CONCURSO } from '../components/ConcursoForm.jsx';
import { useToast } from '../components/ui.jsx';

const STEPS = [
  'Lendo o edital…',
  'Identificando órgão, banca e datas…',
  'Mapeando cargos, vagas e salários…',
  'Analisando benefícios e etapas do certame…',
  'Montando disciplinas, questões e pesos…',
  'Organizando tudo para sua revisão…',
];
const MAX_MB = 40;

function AIImport({ onResult }) {
  const { config } = useConfig();
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [showText, setShowText] = useState(false);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!loading) return undefined;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4500);
    return () => clearInterval(t);
  }, [loading]);

  const pick = (f) => {
    setError('');
    if (!f) return;
    const okType = f.type === 'application/pdf' || /\.(pdf|txt|html?)$/i.test(f.name);
    if (!okType) return setError('Envie um arquivo PDF (ou TXT/HTML).');
    if (f.size > MAX_MB * 1024 * 1024) return setError(`O arquivo excede ${MAX_MB} MB.`);
    setFile(f);
  };

  const canSubmit = file || url.trim() || text.trim().length > 50;

  const analyze = async () => {
    setError('');
    if (url.trim()) { try { new URL(url.trim()); } catch { return setError('Informe uma URL completa, começando com https://'); } }
    setLoading(true);
    try {
      const payload = { url: url.trim() || undefined, text: text.trim() || undefined };
      if (file) {
        payload.fileBase64 = await fileToBase64(file);
        payload.mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain');
      }
      const r = await api.extrair(payload);
      onResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (config && !config.iaDisponivel) {
    return (
      <div className="card callout callout-warning">
        <AlertCircle size={22} />
        <div>
          <strong>Configure a IA para ler editais automaticamente</strong>
          <p>Informe sua chave da API Gemini em Configurações (é gratuita para começar, em aistudio.google.com). Enquanto isso, você pode cadastrar manualmente.</p>
          <div className="row gap">
            <a className="btn btn-primary btn-sm" href="#/config"><Settings size={16} /> Ir para Configurações</a>
            <a className="btn btn-ghost btn-sm" href="#/novo?modo=manual"><PenLine size={16} /> Cadastrar manualmente</a>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card ai-loading" aria-live="polite">
        <div className="ai-orb"><Sparkles size={34} /></div>
        <h2>Analisando o edital com IA</h2>
        <p className="muted">Isso costuma levar de 20 segundos a 2 minutos, dependendo do tamanho do edital.</p>
        <ol className="ai-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? 'done' : i === step ? 'current' : ''}>
              {i < step ? <CheckCircle2 size={16} /> : <span className="dot" />} {s}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="card ai-import">
      <div
        className={`dropzone ${drag ? 'drag' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
        onClick={() => !file && inputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !file && inputRef.current?.click()}
        aria-label="Enviar edital em PDF"
      >
        <input ref={inputRef} type="file" accept="application/pdf,.pdf,.txt,.html,.htm" hidden onChange={(e) => pick(e.target.files?.[0])} />
        {file ? (
          <div className="file-chip">
            <FileText size={22} />
            <div><strong>{file.name}</strong><span className="muted small">{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
            <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setFile(null); }} aria-label="Remover arquivo"><X size={18} /></button>
          </div>
        ) : (
          <>
            <span className="dz-icon"><UploadCloud size={30} /></span>
            <strong>Arraste o edital em PDF aqui</strong>
            <span className="muted">ou <u>clique para selecionar</u> · até {MAX_MB} MB</span>
          </>
        )}
      </div>

      <div className="divider"><span>e/ou</span></div>

      <label className="field">
        <span className="field-label">Link da página do concurso ou do edital</span>
        <div className="input-icon">
          <Link2 size={17} />
          <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.banca.org.br/concurso-x" />
        </div>
        <span className="field-hint">Se for a página do concurso, tentaremos encontrar o edital nela. A URL também será usada para o monitoramento.</span>
      </label>

      <button type="button" className="link-btn toggle-text" onClick={() => setShowText((s) => !s)} aria-expanded={showText}>
        <Type size={15} /> Colar o texto do edital <ChevronDown size={15} className={showText ? 'rot' : ''} />
      </button>
      {showText && (
        <textarea className="paste-area" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Cole aqui o conteúdo do edital ou do extrato de abertura…" />
      )}

      {error && <div className="alert alert-error" role="alert"><AlertCircle size={18} /> {error}</div>}

      <div className="ai-actions">
        <span className="muted small">A IA pode cometer erros. Você revisará tudo antes de salvar.</span>
        <button className="btn btn-primary btn-lg" disabled={!canSubmit} onClick={analyze}><Wand2 size={19} /> Analisar edital</button>
      </div>
    </div>
  );
}

function normalizeExtraction(d) {
  const iso = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '');
  return {
    ...EMPTY_CONCURSO,
    ...d,
    inscricaoInicio: iso(d.inscricaoInicio),
    inscricaoFim: iso(d.inscricaoFim),
    dataProva: iso(d.dataProva),
    cidades: d.cidades || [],
    cargos: (d.cargos || []).map((c) => ({ ...c, salario: c.salario || '' })),
    beneficios: d.beneficios || [],
    estruturaProva: d.estruturaProva || [],
    cronograma: d.cronograma || [],
    provas: (d.provas || []).filter((p) => p.disciplinas?.length).map((p) => ({
      ...p,
      numAlternativas: p.tipoQuestao === 'certo_errado' ? 2 : (p.numAlternativas >= 2 ? p.numAlternativas : 5),
      disciplinas: p.disciplinas.map((x) => ({ ...x, peso: x.peso || 1, minimoAcertos: x.minimoAcertos || 0 })),
      gabaritoOficial: [],
      gabaritoUsuario: [],
    })),
  };
}

export default function NovoConcurso({ modo }) {
  const [extracted, setExtracted] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => { setExtracted(null); }, [modo]);

  const save = async (data, origem) => {
    setSaving(true);
    try {
      const c = await api.createConcurso({ ...data, origem });
      toast(`${c.sigla || c.orgao} foi adicionado à sua jornada.`, { title: 'Concurso cadastrado' });
      navigate(`/concurso/${c.id}`, { replace: true });
    } catch (e) {
      toast(e.message, { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!modo) {
    return (
      <div className="narrow">
        <a href="#/" className="back-link"><ArrowLeft size={16} /> Voltar</a>
        <h1>Novo concurso</h1>
        <p className="muted">Como você prefere cadastrar o certame?</p>
        <div className="mode-grid">
          <a className="mode-card featured" href="#/novo?modo=ia">
            <span className="mode-badge">Recomendado</span>
            <span className="mode-icon"><Sparkles size={26} /></span>
            <h2>Com inteligência artificial</h2>
            <p>Envie o edital em PDF, o link ou o texto. A IA identifica órgão, banca, datas, local, cargos, salários, benefícios e a estrutura das provas.</p>
            <span className="mode-cta">Começar com IA →</span>
          </a>
          <a className="mode-card" href="#/novo?modo=manual">
            <span className="mode-icon"><PenLine size={26} /></span>
            <h2>Manualmente</h2>
            <p>Preencha você mesmo as informações do concurso. Ideal para certames ainda sem edital ou com poucas informações.</p>
            <span className="mode-cta">Preencher formulário →</span>
          </a>
        </div>
      </div>
    );
  }

  if (modo === 'ia') {
    return (
      <div className="narrow wide-when-form">
        <a href="#/novo" className="back-link"><ArrowLeft size={16} /> Voltar</a>
        {!extracted ? (
          <>
            <h1><Sparkles size={26} className="title-icon" /> Cadastrar com IA</h1>
            <p className="muted">Envie o edital e deixe a IA fazer o trabalho pesado.</p>
            <AIImport onResult={(r) => setExtracted(normalizeExtraction(r.data))} />
          </>
        ) : (
          <>
            <h1>Revise as informações</h1>
            <div className="callout callout-info">
              <CheckCircle2 size={20} />
              <div>
                <strong>Edital analisado!</strong>
                <p>Encontramos {extracted.cargos.length} cargo(s) e {extracted.provas.length} prova(s). Confira os dados abaixo e corrija o que for necessário antes de salvar.</p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setExtracted(null)}>Analisar outro</button>
            </div>
            <ConcursoForm initial={extracted} showProvas saving={saving} onCancel={() => navigate('/')} onSubmit={(d) => save(d, 'ia')} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="narrow wide-when-form">
      <a href="#/novo" className="back-link"><ArrowLeft size={16} /> Voltar</a>
      <h1><PenLine size={24} className="title-icon" /> Cadastro manual</h1>
      <p className="muted">Apenas o nome do órgão é obrigatório — complete o restante quando tiver as informações.</p>
      <ConcursoForm initial={EMPTY_CONCURSO} saving={saving} onCancel={() => navigate('/')} onSubmit={(d) => save(d, 'manual')} />
    </div>
  );
}
