# 🎯 Jornada do Concurseiro

Aplicação web completa para gerenciar os concursos públicos que você deseja prestar — com cadastro manual ou automatizado por IA (leitura do edital), monitoramento automático das páginas de inscrição 2x ao dia, alertas internos e simulador de provas/gabaritos.

## ✨ Funcionalidades

- **Cadastro em dois modos:**
  - **Com Inteligência Artificial (Gemini):** envie o PDF do edital, o link da página na banca ou cole o texto. A IA identifica órgão, sigla, banca, número do edital, URLs, datas de inscrição e prova, taxa, turno, cidades/UF, cargos, vagas, salários, benefícios, etapas do certame, cronograma e a estrutura completa das provas objetivas (disciplinas, número de questões e pesos), abrindo o formulário já preenchido para revisão.
  - **Manual:** formulário completo para preenchimento livre.
- **Painel em cartões (cards):** exibe cada certame com órgão, banca, status das inscrições (com barra de progresso e contagem regressiva), cidade/UF, datas de inscrição, data e turno da prova, cargos e faixa salarial, além de busca, filtros por situação e ordenação.
- **Monitoramento automático (2x ao dia):** verifica as páginas dos concursos às **08:00** e **20:00** (horários configuráveis) ou sob demanda ("Verificar agora"), comparando texto e links publicados, gerando resumo das novidades e disparando **notificações dentro da aplicação** (sino no topo + alertas em tempo real).
- **Provas, disciplinas e gabaritos:**
  - Cadastre uma ou mais provas por concurso, com disciplinas, quantidade de questões, pesos e mínimo de acertos.
  - Suporte a **múltipla escolha** (4 ou 5 alternativas) e **certo/errado** (com opção de penalidade "uma errada anula uma certa", padrão Cebraspe).
  - Grade interativa (clique ou digite no teclado com avanço automático) e preenchimento rápido colando o gabarito inteiro (`ABCDE...` ou `1-A 2-B...`; `X` ou `*` para questão anulada).
  - Cálculo imediato de acertos, erros, questões em branco, anuladas, pontuação ponderada, aproveitamento percentual e desempenho detalhado por disciplina.
- **Backup local:** exportação e importação em JSON; tema claro e escuro.

## 🚀 Como executar

```bash
cd /Users/jeanmoraes/.gemini/antigravity/scratch/jornada-do-concurseiro

# Modo desenvolvimento (API + Vite com hot reload em http://localhost:5173)
npm run dev

# Ou modo produção (gera o build e serve tudo em http://localhost:5174)
npm start
```

### Configurando a chave da IA (Gemini)

Você pode informar sua chave da API Gemini (`GEMINI_API_KEY`, obtida em [aistudio.google.com/apikey](https://aistudio.google.com/apikey)) diretamente na tela **Configurações** da aplicação ou criando um arquivo `.env` na raiz do projeto (veja `.env.example`).
