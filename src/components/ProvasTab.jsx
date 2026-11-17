import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, ClipboardList, ChevronUp, ChevronDown, Settings2, BookOpen, CheckSquare, UserCheck, Trophy, ClipboardPaste, Eraser, Copy, Loader2, Check, AlertTriangle, Info, UploadCloud, Sparkles, FileText, Image as ImageIcon } from 'lucide-react';
import { calcular, totalQuestoes, pontuacaoMaxima, faixas, parseGabarito, gabaritoToString } from '../lib/scoring.js';
import { api, fileToBase64 } from '../lib/api.js';
import { Field, Segmented, Ring, EmptyState, ConfirmDialog, useDebouncedCallback, useToast } from './ui.jsx';
import AnswerGrid from './AnswerGrid.jsx';

const novaProva = (n, cargo = '') => ({
  id: `tmp-${Date.now()}`,
  nome: `Prova objetiva${n > 0 ? ` ${n + 1}` : ''}`,
  cargo,
  tipoQuestao: 'multipla',
  numAlternativas: 5,
  penalidade: false,
  notaMinima: 0,
  disciplinas: [
    { nome: 'Língua Portuguesa', qtdQuestoes: 10, peso: 1, minimoAcertos: 0 },
    { nome: 'Conhecimentos Específicos', qtdQuestoes: 20, peso: 2, minimoAcertos: 0 },
  ],
  gabaritoOficial: [],
  gabaritoUsuario: [],
});

const fmtN = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));
const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

function DisciplinasEditor({ prova, onChange }) {
  const ranges = faixas(prova);
  const ds = prova.disciplinas || [];
  const set = (i, patch) => onChange(ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= ds.length) return;
    const next = [...ds];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const numInput = (v, on, step = 1, min = 0) => (
    <input type="number" inputMode="decimal" min={min} step={step} value={v ?? ''} onChange={(e) => on(e.target.value === '' ? '' : Number(e.target.value))} />
  );
  return (
    <div className="table-wrap">
      <table className="table disc-table">
        <thead>
          <tr><th>Disciplina</th><th className="num">Questões</th><th className="num">Peso</th><th className="num" title="Mínimo de acertos exigido (0 = sem mínimo)">Mín. acertos</th><th className="num">Faixa</th><th className="num">Pontos máx.</th><th aria-label="Ações" /></tr>
        </thead>
        <tbody>
          {ds.map((d, i) => (
            <tr key={i}>
              <td><input value={d.nome} onChange={(e) => set(i, { nome: e.target.value })} placeholder="Nome da disciplina" aria-label="Nome da disciplina" /></td>
              <td className="num w-sm">{numInput(d.qtdQuestoes, (v) => set(i, { qtdQuestoes: v }), 1, 0)}</td>
              <td className="num w-sm">{numInput(d.peso, (v) => set(i, { peso: v }), 0.1, 0)}</td>
              <td className="num w-sm">{numInput(d.minimoAcertos, (v) => set(i, { minimoAcertos: v }), 1, 0)}</td>
              <td className="num muted nowrap">{ranges[i].qtd ? `${ranges[i].inicio}–${ranges[i].fim}` : '—'}</td>
              <td className="num strong">{fmtN((Number(d.qtdQuestoes) || 0) * (Number(d.peso) || 0))}</td>
              <td className="row-actions">
                <button type="button" className="icon-btn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Mover para cima"><ChevronUp size={16} /></button>
                <button type="button" className="icon-btn sm" onClick={() => move(i, 1)} disabled={i === ds.length - 1} aria-label="Mover para baixo"><ChevronDown size={16} /></button>
                <button type="button" className="icon-btn sm danger" onClick={() => onChange(ds.filter((_, j) => j !== i))} aria-label="Remover disciplina"><Trash2 size={16} /></button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...ds, { nome: '', qtdQuestoes: 10, peso: 1, minimoAcertos: 0 }])}><Plus size={15} /> Adicionar disciplina</button></td>
            <td className="num strong">{totalQuestoes(prova)}</td>
            <td colSpan={3} />
            <td className="num strong">{fmtN(pontuacaoMaxima(prova))}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PasteBox({ prova, modo, onApply }) {
  const [txt, setTxt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef(null);
  const toast = useToast();
  const total = totalQuestoes(prova);

  const apply = () => {
    const { respostas, lidas } = parseGabarito(txt, prova, total);
    if (!lidas) return toast('Não reconhecemos respostas no texto colado.', { type: 'warning' });
    onApply(respostas);
    setTxt('');
    toast(`${lidas} resposta(s) aplicada(s).`);
  };

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    const okMime = /^(application\/pdf|text\/plain|image\/(jpeg|jpg|png))$/.test(file.type);
    const okExt = /^(pdf|txt|jpe?g|png)$/.test(ext);
    if (!okMime && !okExt) {
      return toast('Formato inválido. Envie um arquivo PDF, TXT, JPG, JPEG ou PNG.', { type: 'warning' });
    }
    if (file.size > 40 * 1024 * 1024) {
      return toast('O arquivo excede o limite de 40 MB.', { type: 'warning' });
    }
    if (!total) {
      return toast('Cadastre primeiro as disciplinas e a quantidade de questões da prova.', { type: 'warning' });
    }

    setUploading(true);
    setFileName(file.name);
    try {
      const fileBase64 = await fileToBase64(file);
      const r = await api.extrairGabarito({
        fileBase64,
        mimeType: file.type,
        fileName: file.name,
        modo,
        tipoQuestao: prova.tipoQuestao,
        numAlternativas: prova.numAlternativas,
        totalQuestoes: total,
        cargo: prova.cargo,
        nomeProva: prova.nome,
      });
      if (!r.lidas) {
        return toast('A IA não encontrou respostas compatíveis no arquivo enviado.', { type: 'warning' });
      }
      onApply(r.respostas);
      toast(
        `${r.lidas} de ${total} questão(ões) preenchida(s) automaticamente pela IA.${r.observacao ? ` (${r.observacao})` : ''}`,
        { title: modo === 'oficial' ? 'Gabarito oficial extraído' : 'Suas respostas foram extraídas' },
      );
    } catch (e) {
      toast(e.message, { type: 'error' });
    } finally {
      setUploading(false);
      setFileName('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const exemplo = prova.tipoQuestao === 'certo_errado' ? 'CECCE-ECX…' : 'ABDCE-AXB… ou 1-A 2-C 3-X';
  const labelModo = modo === 'oficial' ? 'gabarito oficial' : 'suas respostas (cartão-resposta)';

  return (
    <div className="gab-import-wrap">
      <div
        className={`gab-upload ${drag ? 'drag' : ''} ${uploading ? 'loading' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!uploading) handleFile(e.dataTransfer.files?.[0]); }}
        onClick={() => !uploading && fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !uploading && fileRef.current?.click()}
        aria-label={`Enviar arquivo de ${labelModo} para leitura com IA`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.jpg,.jpeg,.png,application/pdf,text/plain,image/jpeg,image/png"
          hidden
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {uploading ? (
          <div className="gab-upload-content">
            <span className="gab-upload-icon ai-pulse"><Loader2 size={20} className="spin" /></span>
            <div className="gab-upload-text">
              <strong><Sparkles size={14} /> A IA está lendo {fileName || 'o arquivo'} e preenchendo {modo === 'oficial' ? 'o gabarito oficial' : 'suas respostas'}…</strong>
              <span className="muted small">Identificando as questões de 1 a {total}. Aguarde alguns instantes.</span>
            </div>
          </div>
        ) : (
          <div className="gab-upload-content">
            <span className="gab-upload-icon"><UploadCloud size={20} /></span>
            <div className="gab-upload-text">
              <strong>
                <Sparkles size={14} className="ia-spark" /> Importar {labelModo} com IA
              </strong>
              <span className="muted small">
                Arraste ou clique para enviar <b>PDF</b>, <b>TXT</b> ou <b>Imagem (JPG, JPEG, PNG)</b> — preenchimento automático das {total} questões
              </span>
            </div>
            <div className="gab-upload-badges" aria-hidden>
              <span className="chip"><FileText size={12} /> PDF / TXT</span>
              <span className="chip"><ImageIcon size={12} /> JPG / PNG</span>
            </div>
          </div>
        )}
      </div>

      <div className="paste-box">
        <ClipboardPaste size={17} />
        <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={`Ou cole como texto (${modo === 'oficial' ? 'gabarito oficial' : 'suas respostas'}): ${exemplo}`}
          onKeyDown={(e) => e.key === 'Enter' && apply()} aria-label="Colar gabarito" />
        <button type="button" className="btn btn-sm btn-outline" onClick={apply} disabled={!txt.trim()}>Aplicar</button>
      </div>
    </div>
  );
}

function Resultado({ prova }) {
  const r = useMemo(() => calcular(prova), [prova]);
  const t = r.total;
  if (!t.qtd) return null;
  const tone = r.situacao === 'abaixo' ? 'danger' : t.percentual >= 0.7 ? 'success' : t.percentual >= 0.5 ? 'warning' : 'danger';

  return (
    <section className="card resultado">
      <h3 className="block-title"><Trophy size={18} /> Resultado</h3>
      {r.situacao === 'incompleto' && (
        <div className="callout callout-info compact">
          <Info size={18} />
          <p>{!r.preenchidoUsuario ? 'Preencha suas respostas' : 'Cadastre o gabarito oficial'} para calcular sua nota. Questões sem gabarito oficial ficam como pendentes.</p>
        </div>
      )}
      <div className="res-top">
        <Ring value={t.percentual} size={148} stroke={12} tone={r.situacao === 'incompleto' ? 'primary' : tone}>
          <strong>{fmtN(Math.round(t.pontos * 100) / 100)}</strong>
          <span>de {fmtN(t.maximo)} pts</span>
        </Ring>
        <div className="res-summary">
          <div className="res-kpis">
            <div className="kpi k-success"><strong>{t.acertos}</strong><span>Acertos</span></div>
            <div className="kpi k-danger"><strong>{t.erros}</strong><span>Erros</span></div>
            <div className="kpi k-muted"><strong>{t.brancos}</strong><span>Em branco</span></div>
            <div className="kpi k-info"><strong>{t.anuladas}</strong><span>Anuladas</span></div>
            {t.pendentes > 0 && <div className="kpi k-warning"><strong>{t.pendentes}</strong><span>Sem gabarito</span></div>}
          </div>
          <p className="res-line">
            Aproveitamento de <strong>{pct(t.percentual)}</strong>
            {prova.penalidade && <span className="muted"> · com desconto de erros (uma errada anula uma certa)</span>}
          </p>
          {r.situacao !== 'incompleto' && (r.notaMinima > 0 || r.disciplinas.some((d) => d.minimo > 0)) && (
            <p className={`res-status ${r.situacao === 'ok' ? 'ok' : 'bad'}`}>
              {r.situacao === 'ok' ? <Check size={16} /> : <AlertTriangle size={16} />}
              {r.situacao === 'ok'
                ? 'Você atingiu os critérios mínimos informados.'
                : r.reprovadoDisciplina ? 'Abaixo do mínimo de acertos em alguma disciplina.' : `Abaixo da nota mínima de ${fmtN(r.notaMinima)} pontos.`}
            </p>
          )}
          <p className="muted small">Questões anuladas são consideradas corretas para todos os candidatos.</p>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table res-table">
          <thead><tr><th>Disciplina</th><th className="num">Acertos</th><th className="num">Erros</th><th className="num">Branco</th><th className="num">Anul.</th><th className="num">Peso</th><th className="num">Pontos</th><th>Desempenho</th></tr></thead>
          <tbody>
            {r.disciplinas.map((d, i) => (
              <tr key={i} className={d.atingiuMinimo === false ? 'row-bad' : ''}>
                <td>
                  <strong>{d.nome}</strong>
                  {d.minimo > 0 && <div className={`small ${d.atingiuMinimo === false ? 'text-danger' : 'muted'}`}>mín. {d.minimo} acertos</div>}
                </td>
                <td className="num text-success">{d.acertos}</td>
                <td className="num text-danger">{d.erros}</td>
                <td className="num">{d.brancos}</td>
                <td className="num">{d.anuladas}</td>
                <td className="num">{fmtN(d.peso)}</td>
                <td className="num strong">{fmtN(Math.round(d.pontos * 100) / 100)} <span className="muted">/ {fmtN(d.maximo)}</span></td>
                <td className="perf">
                  <div className="bar"><span style={{ width: `${d.percentual * 100}%` }} className={d.percentual >= 0.7 ? 'b-success' : d.percentual >= 0.5 ? 'b-warning' : 'b-danger'} /></div>
                  <span className="small">{pct(d.percentual)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProvaEditor({ prova, onChange, onDelete, cargos }) {
  const [modo, setModo] = useState('usuario');
  const [mostrarCorrecao, setMostrarCorrecao] = useState(true);
  const toast = useToast();
  const set = (patch) => onChange({ ...prova, ...patch });
  const total = totalQuestoes(prova);
  const campo = modo === 'oficial' ? 'gabaritoOficial' : 'gabaritoUsuario';
  const valores = prova[campo] || [];
  const preenchidas = valores.slice(0, total).filter(Boolean).length;

  const copy = async () => {
    await navigator.clipboard.writeText(gabaritoToString(valores, total));
    toast('Gabarito copiado como texto.');
  };

  return (
    <div className="prova-editor">
      <section className="card">
        <h3 className="block-title"><Settings2 size={18} /> Configuração da prova
          <button type="button" className="btn btn-ghost btn-sm danger push" onClick={onDelete}><Trash2 size={15} /> Excluir prova</button>
        </h3>
        <div className="grid-form">
          <Field label="Nome da prova" className="span-2"><input value={prova.nome} onChange={(e) => set({ nome: e.target.value })} /></Field>
          <Field label="Cargo" className="span-2">
            <input value={prova.cargo || ''} onChange={(e) => set({ cargo: e.target.value })} list="cargos-concurso" placeholder="Cargo(s) a que se aplica" />
            <datalist id="cargos-concurso">{cargos.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Tipo de questão" className="span-2">
            <Segmented value={prova.tipoQuestao} onChange={(v) => set({ tipoQuestao: v, numAlternativas: v === 'certo_errado' ? 2 : 5, penalidade: v === 'certo_errado' ? true : prova.penalidade })}
              options={[{ value: 'multipla', label: 'Múltipla escolha' }, { value: 'certo_errado', label: 'Certo ou errado' }]} />
          </Field>
          {prova.tipoQuestao === 'multipla' ? (
            <Field label="Alternativas">
              <Segmented value={Number(prova.numAlternativas) || 5} onChange={(v) => set({ numAlternativas: v })} options={[{ value: 4, label: 'A–D' }, { value: 5, label: 'A–E' }]} />
            </Field>
          ) : <div />}
          <Field label="Nota mínima (pontos)" hint="0 = sem nota mínima">
            <input type="number" min={0} step={0.5} value={prova.notaMinima ?? 0} onChange={(e) => set({ notaMinima: Number(e.target.value) })} />
          </Field>
          <label className="switch span-4">
            <input type="checkbox" checked={!!prova.penalidade} onChange={(e) => set({ penalidade: e.target.checked })} />
            <span className="switch-ui" />
            <span><strong>Uma errada anula uma certa</strong> <span className="muted small">— cada erro desconta o valor de uma questão (comum em provas do Cebraspe).</span></span>
          </label>
        </div>
      </section>

      <section className="card">
        <h3 className="block-title"><BookOpen size={18} /> Disciplinas, questões e pesos</h3>
        <DisciplinasEditor prova={prova} onChange={(disciplinas) => set({ disciplinas })} />
      </section>

      <section className="card">
        <div className="gab-head">
          <h3 className="block-title"><CheckSquare size={18} /> Gabaritos</h3>
          <Segmented value={modo} onChange={setModo} options={[
            { value: 'usuario', label: <><UserCheck size={15} /> Minhas respostas</> },
            { value: 'oficial', label: <><CheckSquare size={15} /> Gabarito oficial</> },
          ]} />
        </div>
        <div className="gab-toolbar">
          <span className="muted small">{preenchidas}/{total} preenchidas · Dica: clique em uma questão e use o teclado ({prova.tipoQuestao === 'certo_errado' ? 'C/E' : 'A–E ou 1–5'}{modo === 'oficial' ? ', X para anular' : ''}). O cursor avança sozinho.</span>
          <div className="row gap-sm">
            {modo === 'usuario' && (
              <label className="check-inline"><input type="checkbox" checked={mostrarCorrecao} onChange={(e) => setMostrarCorrecao(e.target.checked)} /> Mostrar correção</label>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={copy} disabled={!preenchidas}><Copy size={15} /> Copiar</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ [campo]: [] })} disabled={!preenchidas}><Eraser size={15} /> Limpar</button>
          </div>
        </div>
        <PasteBox prova={prova} modo={modo} onApply={(arr) => set({ [campo]: arr })} />
        <AnswerGrid prova={prova} modo={modo} valores={valores} onChange={(arr) => set({ [campo]: arr })} mostrarCorrecao={mostrarCorrecao} />
      </section>

      <Resultado prova={prova} />
    </div>
  );
}

export default function ProvasTab({ concurso, onSave }) {
  const [provas, setProvas] = useState(() => concurso.provas || []);
  const [sel, setSel] = useState(0);
  const [saveState, setSaveState] = useState('saved');
  const [confirm, setConfirm] = useState(null);
  const cargos = (concurso.cargos || []).map((c) => c.nome).filter(Boolean);

  useEffect(() => { setProvas(concurso.provas || []); setSel(0); }, [concurso.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useDebouncedCallback(async (list) => {
    setSaveState('saving');
    try { await onSave(list); setSaveState('saved'); } catch { setSaveState('error'); }
  }, 700);

  const commit = (list) => {
    setProvas(list);
    setSaveState('pending');
    persist(list);
  };

  const add = () => {
    const list = [...provas, novaProva(provas.length, concurso.cargoInteresse || cargos[0] || '')];
    commit(list);
    setSel(list.length - 1);
  };

  if (!provas.length) {
    return (
      <EmptyState icon={ClipboardList} title="Nenhuma prova cadastrada"
        actions={<button className="btn btn-primary" onClick={add}><Plus size={17} /> Cadastrar prova</button>}>
        Cadastre a prova com suas disciplinas, quantidade de questões e pesos. Depois, informe o gabarito oficial e as suas respostas para calcular sua nota automaticamente.
      </EmptyState>
    );
  }

  const idx = Math.min(sel, provas.length - 1);
  const atual = provas[idx];

  return (
    <div className="provas-tab">
      <div className="provas-bar">
        <div className="prova-pills" role="tablist" aria-label="Provas">
          {provas.map((p, i) => {
            const r = calcular(p);
            return (
              <button key={p.id || i} role="tab" aria-selected={i === idx} className={`prova-pill ${i === idx ? 'active' : ''}`} onClick={() => setSel(i)}>
                <strong>{p.nome || `Prova ${i + 1}`}</strong>
                <span>{p.cargo ? `${p.cargo} · ` : ''}{totalQuestoes(p)} {p.tipoQuestao === 'certo_errado' ? 'itens' : 'questões'}{r.situacao !== 'incompleto' ? ` · ${pct(r.total.percentual)}` : ''}</span>
              </button>
            );
          })}
          <button className="prova-pill add" onClick={add}><Plus size={16} /> Nova prova</button>
        </div>
        <span className={`save-indicator ${saveState}`} aria-live="polite">
          {saveState === 'saving' || saveState === 'pending' ? <><Loader2 size={14} className="spin" /> Salvando…</> : saveState === 'error' ? <><AlertTriangle size={14} /> Erro ao salvar</> : <><Check size={14} /> Salvo</>}
        </span>
      </div>

      <ProvaEditor key={atual.id || idx} prova={atual} cargos={cargos}
        onChange={(p) => commit(provas.map((x, i) => (i === idx ? p : x)))}
        onDelete={() => setConfirm(idx)} />

      <ConfirmDialog open={confirm !== null} danger title="Excluir prova?" confirmLabel="Excluir"
        message="A prova, suas disciplinas e os gabaritos cadastrados serão removidos."
        onCancel={() => setConfirm(null)}
        onConfirm={() => { commit(provas.filter((_, i) => i !== confirm)); setSel(0); setConfirm(null); }} />
    </div>
  );
}
