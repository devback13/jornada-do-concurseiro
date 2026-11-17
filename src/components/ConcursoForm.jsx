import { useState } from 'react';
import { Building2, CalendarDays, Briefcase, Gift, ListChecks, CalendarClock, StickyNote, Plus, Trash2, Loader2, Save, Radar, ClipboardList, Info } from 'lucide-react';
import { Field, TagInput, Segmented } from './ui.jsx';
import { BANCAS, UFS, TURNOS, ESCOLARIDADES } from '../lib/format.js';
import { totalQuestoes } from '../lib/scoring.js';

export const EMPTY_CONCURSO = {
  orgao: '', sigla: '', banca: '', numeroEdital: '', url: '', editalUrl: '',
  inscricaoInicio: '', inscricaoFim: '', taxaInscricao: '', dataProva: '', turnoProva: 'Não informado', horarioProva: '',
  cidades: [], uf: '', cargos: [], beneficios: [], estruturaProva: [], cronograma: [], provas: [], observacoes: '', resumo: '',
};

const EMPTY_CARGO = { nome: '', vagas: '', salario: '', escolaridade: '', requisitos: '', jornada: '' };

/** Aceita número ou texto no formato brasileiro ("13.994,78", "R$ 5000"). */
function parseMoney(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').replace(/[^\d.,]/g, '');
  if (!s) return 0;
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/\.(?=\d{3}(\D|$))/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function Section({ icon: Icon, title, desc, children, action }) {
  return (
    <section className="form-section card">
      <header>
        <span className="section-icon"><Icon size={18} /></span>
        <div><h2>{title}</h2>{desc && <p className="muted small">{desc}</p>}</div>
        {action && <div className="section-action">{action}</div>}
      </header>
      <div className="form-section-body">{children}</div>
    </section>
  );
}

function RowList({ items, onChange, empty, render, newItem, addLabel }) {
  const update = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const remove = (i) => onChange(items.filter((_, j) => j !== i));
  return (
    <div className="rowlist">
      {items.length === 0 && <p className="muted small rowlist-empty">{empty}</p>}
      {items.map((it, i) => (
        <div className="rowlist-item" key={i}>
          <div className="rowlist-fields">{render(it, (p) => update(i, p), i)}</div>
          <button type="button" className="icon-btn danger" onClick={() => remove(i)} aria-label="Remover"><Trash2 size={17} /></button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm add-row" onClick={() => onChange([...items, { ...newItem }])}><Plus size={16} /> {addLabel}</button>
    </div>
  );
}

export default function ConcursoForm({ initial, onSubmit, onCancel, submitLabel = 'Salvar concurso', saving, showProvas }) {
  const [f, setF] = useState(() => ({ ...EMPTY_CONCURSO, ...initial }));
  const [errors, setErrors] = useState({});
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));

  const submit = (e) => {
    e.preventDefault();
    const errs = {};
    if (!f.orgao.trim()) errs.orgao = 'Informe o nome do órgão.';
    if (f.url) { try { new URL(f.url); } catch { errs.url = 'Informe uma URL completa, começando com https://'; } }
    if (f.inscricaoInicio && f.inscricaoFim && f.inscricaoFim < f.inscricaoInicio) errs.inscricaoFim = 'O término deve ser após o início.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.querySelector('.field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    onSubmit({
      ...f,
      orgao: f.orgao.trim(),
      cargos: f.cargos.filter((c) => c.nome?.trim()).map((c) => ({ ...c, salario: parseMoney(c.salario) })),
      estruturaProva: f.estruturaProva.filter((x) => x.etapa?.trim()),
      cronograma: f.cronograma.filter((x) => x.evento?.trim()),
    });
  };

  return (
    <form className="concurso-form" onSubmit={submit} noValidate>
      <Section icon={Building2} title="Identificação" desc="Quem realiza o concurso e onde acompanhar.">
        <div className="grid-form">
          <Field label="Órgão" required className="span-2" error={errors.orgao}>
            <input value={f.orgao} onChange={set('orgao')} placeholder="Ex.: Tribunal Regional Federal da 1ª Região" autoFocus={!initial?.orgao} />
          </Field>
          <Field label="Sigla">
            <input value={f.sigla} onChange={set('sigla')} placeholder="Ex.: TRF1" maxLength={16} />
          </Field>
          <Field label="Banca organizadora">
            <input value={f.banca} onChange={set('banca')} list="bancas" placeholder="Ex.: Cebraspe" />
            <datalist id="bancas">{BANCAS.map((b) => <option key={b} value={b} />)}</datalist>
          </Field>
          <Field label="Página do concurso / inscrição" className="span-2" error={errors.url}
            hint={<><Radar size={13} /> Esta página será verificada automaticamente 2x ao dia para detectar alterações.</>}>
            <input type="url" value={f.url} onChange={set('url')} placeholder="https://www.cebraspe.org.br/concursos/…" inputMode="url" />
          </Field>
          <Field label="Número do edital">
            <input value={f.numeroEdital} onChange={set('numeroEdital')} placeholder="Ex.: Edital nº 1/2026" />
          </Field>
          <Field label="Link do edital (PDF)">
            <input type="url" value={f.editalUrl} onChange={set('editalUrl')} placeholder="https://…/edital.pdf" inputMode="url" />
          </Field>
        </div>
      </Section>

      <Section icon={CalendarDays} title="Datas e local de prova">
        <div className="grid-form">
          <Field label="Início das inscrições"><input type="date" value={f.inscricaoInicio} onChange={set('inscricaoInicio')} /></Field>
          <Field label="Término das inscrições" error={errors.inscricaoFim}><input type="date" value={f.inscricaoFim} onChange={set('inscricaoFim')} /></Field>
          <Field label="Taxa de inscrição" className="span-2"><input value={f.taxaInscricao} onChange={set('taxaInscricao')} placeholder="Ex.: R$ 85,00 (médio) / R$ 120,00 (superior)" /></Field>
          <Field label="Data da prova"><input type="date" value={f.dataProva} onChange={set('dataProva')} /></Field>
          <Field label="Horário / duração"><input value={f.horarioProva} onChange={set('horarioProva')} placeholder="Ex.: 8h às 12h30" /></Field>
          <Field label="Turno da prova" className="span-2">
            <Segmented options={TURNOS} value={f.turnoProva || 'Não informado'} onChange={set('turnoProva')} size="sm" />
          </Field>
          <Field label="Cidades de prova" className="span-3" hint="Pressione Enter ou vírgula para adicionar cada cidade.">
            <TagInput value={f.cidades} onChange={set('cidades')} placeholder="Ex.: Brasília, Goiânia" />
          </Field>
          <Field label="UF">
            <select value={f.uf} onChange={set('uf')}>
              <option value="">Selecione</option>
              {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      <Section icon={Briefcase} title="Cargos e salários" desc="Inclua os cargos de interesse com vagas e remuneração.">
        <RowList items={f.cargos} onChange={set('cargos')} newItem={EMPTY_CARGO} addLabel="Adicionar cargo" empty="Nenhum cargo cadastrado."
          render={(c, up) => (
            <div className="grid-form cargo-row">
              <Field label="Cargo" className="span-2"><input value={c.nome} onChange={(e) => up({ nome: e.target.value })} placeholder="Ex.: Analista Judiciário – Área Administrativa" /></Field>
              <Field label="Vagas"><input value={c.vagas} onChange={(e) => up({ vagas: e.target.value })} placeholder="Ex.: 10 + CR" /></Field>
              <Field label="Salário (R$)"><input inputMode="decimal" value={c.salario || ''} onChange={(e) => up({ salario: e.target.value })} placeholder="Ex.: 13994,78" /></Field>
              <Field label="Escolaridade">
                <select value={c.escolaridade} onChange={(e) => up({ escolaridade: e.target.value })}>
                  <option value="">—</option>
                  {[...new Set([...ESCOLARIDADES, c.escolaridade].filter(Boolean))].map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Jornada"><input value={c.jornada} onChange={(e) => up({ jornada: e.target.value })} placeholder="Ex.: 40h semanais" /></Field>
              <Field label="Requisitos" className="span-2"><input value={c.requisitos} onChange={(e) => up({ requisitos: e.target.value })} placeholder="Ex.: Nível superior em qualquer área" /></Field>
            </div>
          )} />
      </Section>

      <Section icon={Gift} title="Benefícios">
        <TagInput value={f.beneficios} onChange={set('beneficios')} placeholder="Ex.: Auxílio-alimentação R$ 1.393,10, Plano de saúde…" />
      </Section>

      <Section icon={ListChecks} title="Estrutura do certame" desc="Etapas como prova objetiva, discursiva, TAF, títulos…">
        <RowList items={f.estruturaProva} onChange={set('estruturaProva')} newItem={{ etapa: '', carater: '', descricao: '' }} addLabel="Adicionar etapa" empty="Nenhuma etapa cadastrada."
          render={(x, up) => (
            <div className="grid-form">
              <Field label="Etapa"><input value={x.etapa} onChange={(e) => up({ etapa: e.target.value })} placeholder="Prova objetiva" /></Field>
              <Field label="Caráter"><input value={x.carater} onChange={(e) => up({ carater: e.target.value })} placeholder="Eliminatório e classificatório" list="carateres" /></Field>
              <Field label="Descrição" className="span-2"><input value={x.descricao} onChange={(e) => up({ descricao: e.target.value })} placeholder="120 itens, nota mínima…" /></Field>
            </div>
          )} />
        <datalist id="carateres"><option value="Eliminatório" /><option value="Classificatório" /><option value="Eliminatório e classificatório" /></datalist>
      </Section>

      <Section icon={CalendarClock} title="Cronograma">
        <RowList items={f.cronograma} onChange={set('cronograma')} newItem={{ evento: '', data: '' }} addLabel="Adicionar evento" empty="Nenhum evento cadastrado."
          render={(x, up) => (
            <div className="grid-form">
              <Field label="Evento" className="span-3"><input value={x.evento} onChange={(e) => up({ evento: e.target.value })} placeholder="Ex.: Resultado final" /></Field>
              <Field label="Data"><input type={/^\d{4}-\d{2}-\d{2}$/.test(x.data) || !x.data ? 'date' : 'text'} value={x.data} onChange={(e) => up({ data: e.target.value })} /></Field>
            </div>
          )} />
      </Section>

      {showProvas && f.provas?.length > 0 && (
        <Section icon={ClipboardList} title="Provas identificadas" desc="Serão criadas com as disciplinas, questões e pesos. Você poderá ajustar depois, na aba Provas e gabaritos.">
          <ul className="provas-preview">
            {f.provas.map((p, i) => (
              <li key={i}>
                <div className="pp-head">
                  <strong>{p.nome || `Prova ${i + 1}`}</strong>
                  <span className="muted small">{p.cargo} · {totalQuestoes(p)} {p.tipoQuestao === 'certo_errado' ? 'itens C/E' : 'questões'}</span>
                  <button type="button" className="icon-btn danger sm" aria-label="Remover prova" onClick={() => set('provas')(f.provas.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
                </div>
                <div className="pp-disc">
                  {(p.disciplinas || []).map((d, j) => <span key={j} className="chip">{d.nome} · {d.qtdQuestoes}q · peso {d.peso}</span>)}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section icon={StickyNote} title="Observações">
        <div className="grid-form">
          <Field label="Resumo" className="span-4"><textarea rows={2} value={f.resumo} onChange={set('resumo')} placeholder="Breve descrição do concurso" /></Field>
          <Field label="Outras informações" className="span-4"><textarea rows={4} value={f.observacoes} onChange={set('observacoes')} placeholder="Isenção, cotas, validade, critérios de aprovação…" /></Field>
        </div>
        <p className="muted small inline-info"><Info size={14} /> Disciplinas, questões, pesos e gabaritos são cadastrados na aba <strong>Provas e gabaritos</strong> do concurso.</p>
      </Section>

      <div className="form-actions">
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <Loader2 size={18} className="spin" /> : <Save size={18} />} {submitLabel}
        </button>
      </div>
    </form>
  );
}
