// Cálculo de notas a partir do gabarito oficial e das respostas do candidato.
// Convenções do gabarito: letra = resposta; 'X' = questão anulada; '' = não preenchido.

export function opcoes(prova) {
  if (prova.tipoQuestao === 'certo_errado') return ['C', 'E'];
  const n = Math.min(Math.max(Number(prova.numAlternativas) || 5, 2), 6);
  return 'ABCDEF'.slice(0, n).split('');
}

export function totalQuestoes(prova) {
  return (prova.disciplinas || []).reduce((s, d) => s + (Number(d.qtdQuestoes) || 0), 0);
}

export function pontuacaoMaxima(prova) {
  return (prova.disciplinas || []).reduce((s, d) => s + (Number(d.qtdQuestoes) || 0) * (Number(d.peso) || 0), 0);
}

/** Faixas de numeração de cada disciplina (1-based, inclusivas). */
export function faixas(prova) {
  let start = 1;
  return (prova.disciplinas || []).map((d) => {
    const qtd = Math.max(0, Number(d.qtdQuestoes) || 0);
    const r = { inicio: start, fim: start + qtd - 1, qtd };
    start += qtd;
    return r;
  });
}

export function calcular(prova) {
  const oficial = prova.gabaritoOficial || [];
  const usuario = prova.gabaritoUsuario || [];
  const penal = Boolean(prova.penalidade);
  const ranges = faixas(prova);

  const disciplinas = (prova.disciplinas || []).map((d, i) => {
    const { inicio, qtd } = ranges[i];
    const peso = Number(d.peso) || 0;
    let acertos = 0; let erros = 0; let brancos = 0; let anuladas = 0; let pendentes = 0;
    for (let q = inicio - 1; q < inicio - 1 + qtd; q++) {
      const of = oficial[q] || '';
      const us = usuario[q] || '';
      if (of === 'X') anuladas++;
      else if (!of) pendentes++;
      else if (!us) brancos++;
      else if (us === of) acertos++;
      else erros++;
    }
    const pontos = (acertos + anuladas) * peso - (penal ? erros * peso : 0);
    const maximo = qtd * peso;
    const minimo = Number(d.minimoAcertos) || 0;
    return {
      nome: d.nome || `Disciplina ${i + 1}`,
      peso, qtd, acertos, erros, brancos, anuladas, pendentes, pontos, maximo,
      percentual: maximo > 0 ? Math.max(0, pontos) / maximo : 0,
      minimo,
      atingiuMinimo: minimo > 0 ? acertos + anuladas >= minimo : null,
    };
  });

  const sum = (k) => disciplinas.reduce((s, d) => s + d[k], 0);
  const pontos = sum('pontos');
  const maximo = sum('maximo');
  const notaMinima = Number(prova.notaMinima) || 0; // em pontos
  const reprovadoDisciplina = disciplinas.some((d) => d.atingiuMinimo === false);
  const preenchidoOficial = oficial.filter(Boolean).length;
  const preenchidoUsuario = usuario.filter(Boolean).length;

  return {
    disciplinas,
    total: {
      qtd: sum('qtd'), acertos: sum('acertos'), erros: sum('erros'), brancos: sum('brancos'),
      anuladas: sum('anuladas'), pendentes: sum('pendentes'), pontos, maximo,
      percentual: maximo > 0 ? Math.max(0, pontos) / maximo : 0,
    },
    notaMinima,
    situacao: !preenchidoOficial || !preenchidoUsuario
      ? 'incompleto'
      : reprovadoDisciplina || (notaMinima > 0 && pontos < notaMinima) ? 'abaixo' : 'ok',
    reprovadoDisciplina,
    preenchidoOficial,
    preenchidoUsuario,
  };
}

/**
 * Interpreta um gabarito colado. Aceita:
 *  - sequência: "ABCDE-ABX..." (- ou . = em branco, X ou * = anulada)
 *  - numerado: "1-A 2-B 3) C 4: X"
 */
export function parseGabarito(texto, prova, total) {
  const validas = new Set([...opcoes(prova), 'X']);
  const src = (texto || '').toUpperCase();
  const out = Array(total).fill('');
  const norm = (ch) => (ch === '*' || ch === '#' ? 'X' : ch);

  if (/\d/.test(src)) {
    const re = /(\d+)\s*[-.:)=]?\s*([A-F*#X])\b/g;
    let m; let found = 0;
    while ((m = re.exec(src))) {
      const n = Number(m[1]);
      const v = norm(m[2]);
      if (n >= 1 && n <= total && validas.has(v)) { out[n - 1] = v; found++; }
    }
    return { respostas: out, lidas: found };
  }

  let i = 0;
  for (const raw of src.replace(/\s+/g, '')) {
    if (i >= total) break;
    const ch = norm(raw);
    if (validas.has(ch)) out[i++] = ch;
    else if (ch === '-' || ch === '.' || ch === '_') out[i++] = '';
  }
  return { respostas: out, lidas: i };
}

export function gabaritoToString(arr = [], total) {
  return Array.from({ length: total }, (_, i) => arr[i] || '-').join('');
}
