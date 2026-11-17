import { useRef, useState } from 'react';
import { opcoes, faixas } from '../lib/scoring.js';

/**
 * Grade de respostas agrupada por disciplina.
 * modo 'oficial': permite anular (X). modo 'usuario': colore acertos/erros se houver gabarito oficial.
 */
export default function AnswerGrid({ prova, modo, valores, onChange, mostrarCorrecao }) {
  const ops = opcoes(prova);
  const opsComX = modo === 'oficial' ? [...ops, 'X'] : ops;
  const ranges = faixas(prova);
  const total = ranges.reduce((s, r) => s + r.qtd, 0);
  const oficial = prova.gabaritoOficial || [];
  const refs = useRef({});
  const [focusIdx, setFocusIdx] = useState(null);

  const setAt = (i, v, advance = false) => {
    const next = Array.from({ length: total }, (_, k) => valores[k] || '');
    next[i] = next[i] === v ? '' : v;
    onChange(next);
    if (advance && i + 1 < total) refs.current[i + 1]?.focus();
  };

  const onKey = (e, i) => {
    const k = e.key.toUpperCase();
    if (opsComX.includes(k) || (k === '*' && modo === 'oficial')) {
      e.preventDefault();
      const v = k === '*' ? 'X' : k;
      const next = Array.from({ length: total }, (_, j) => valores[j] || '');
      next[i] = v;
      onChange(next);
      if (i + 1 < total) refs.current[i + 1]?.focus();
    } else if (/^[1-6]$/.test(k) && prova.tipoQuestao !== 'certo_errado' && ops[Number(k) - 1]) {
      e.preventDefault();
      const next = Array.from({ length: total }, (_, j) => valores[j] || '');
      next[i] = ops[Number(k) - 1];
      onChange(next);
      if (i + 1 < total) refs.current[i + 1]?.focus();
    } else if (k === 'BACKSPACE' || k === 'DELETE' || k === ' ' || k === '-') {
      e.preventDefault();
      const next = Array.from({ length: total }, (_, j) => valores[j] || '');
      next[i] = '';
      onChange(next);
      if (k === 'BACKSPACE' && i > 0) refs.current[i - 1]?.focus();
    } else if (k === 'ARROWRIGHT' || k === 'ARROWDOWN') {
      e.preventDefault(); refs.current[Math.min(i + 1, total - 1)]?.focus();
    } else if (k === 'ARROWLEFT' || k === 'ARROWUP') {
      e.preventDefault(); refs.current[Math.max(i - 1, 0)]?.focus();
    }
  };

  if (!total) return <p className="muted">Cadastre as disciplinas e a quantidade de questões para preencher o gabarito.</p>;

  return (
    <div className="answer-grid">
      {(prova.disciplinas || []).map((d, di) => {
        const r = ranges[di];
        if (!r.qtd) return null;
        const filled = Array.from({ length: r.qtd }, (_, k) => valores[r.inicio - 1 + k]).filter(Boolean).length;
        return (
          <section key={di} className="ag-block">
            <header>
              <strong>{d.nome || `Disciplina ${di + 1}`}</strong>
              <span className="muted small">Questões {r.inicio}–{r.fim} · {filled}/{r.qtd} preenchidas</span>
            </header>
            <div className={`ag-cells ${prova.tipoQuestao === 'certo_errado' ? 'ce' : ''}`}>
              {Array.from({ length: r.qtd }, (_, k) => {
                const i = r.inicio - 1 + k;
                const v = valores[i] || '';
                const of = oficial[i] || '';
                let state = '';
                if (modo === 'usuario' && mostrarCorrecao && of) {
                  if (of === 'X') state = 'anulada';
                  else if (!v) state = 'branco';
                  else state = v === of ? 'certa' : 'errada';
                }
                if (modo === 'oficial' && v === 'X') state = 'anulada';
                return (
                  <div key={i} ref={(el) => { refs.current[i] = el; }} tabIndex={0}
                    className={`ag-cell ${state} ${focusIdx === i ? 'focus' : ''}`}
                    onFocus={() => setFocusIdx(i)} onBlur={() => setFocusIdx(null)}
                    onKeyDown={(e) => onKey(e, i)}
                    aria-label={`Questão ${i + 1}: ${v || 'sem resposta'}`}>
                    <span className="ag-n">{String(i + 1).padStart(total >= 100 ? 3 : 2, '0')}</span>
                    <div className="ag-opts">
                      {opsComX.map((o) => (
                        <button type="button" key={o} tabIndex={-1}
                          className={`ag-opt ${v === o ? 'sel' : ''} ${o === 'X' ? 'opt-x' : ''} ${state === 'errada' && o === of ? 'correct-hint' : ''}`}
                          onClick={() => setAt(i, o)} title={o === 'X' ? 'Anulada' : o}>
                          {o}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
