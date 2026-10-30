import { expect, mock, test } from 'claude-code/testing'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 27, 18, 0)

const BAND = {
  plugin: 'lembrete-salva',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

type Repo = { isRepo: boolean; dirty: number; ahead: number; upstreamAt: number }

// O git de mentira: cada teste muda `repo` e o mod lê na próxima conferência.
function fakeGit(on: any, repo: Repo) {
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const cmd = e.argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (!repo.isRepo) return out('', 128)
    if (cmd === 'git rev-parse --is-inside-work-tree') return out('true\n')
    if (cmd === 'git status --porcelain') return out(Array.from({ length: repo.dirty }, (_, i) => ` M f${i}.md`).join('\n'))
    if (cmd === 'git log -1 --format=%ct @{u}')
      return repo.upstreamAt ? out(`${Math.floor(repo.upstreamAt / 1000)}\n`) : out('', 128)
    if (cmd === 'git rev-list --count @{u}..HEAD') return repo.upstreamAt ? out(`${repo.ahead}\n`) : out('', 128)
    return out('', 1)
  })
}

// O $.store de mentira, numa caixa que o teste também lê e escreve: as outras conversas
// do app só existem para este mod pelo que deixam ali.
type Loja = Record<string, unknown>

async function setup($: any, on: any, repo: Repo, extra?: (on: any) => void, inicial?: Loja, comandos = ['salva']) {
  const clock = mock.clock(on, { now: T0 })
  const loja: Loja = { ...(inicial ?? {}) }
  on('store.get', (_: unknown, e: { key: string }) => ({ value: loja[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    loja[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete loja[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(loja) }))
  fakeGit(on, repo)
  const submitted: string[] = []
  const toasts: string[] = []
  on('command.run', (_: unknown, e: { command: string; args?: string }) => {
    submitted.push(e.args ? `${e.command} ${e.args}` : e.command)
    return { text: '' }
  })
  on('command.list', () => ({ value: comandos.map(name => ({ name, description: '', source: 'user' })) }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  // Embaixo do mod, o desenho do próprio Claude: uma caixa vazia.
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  extra?.(on)
  on('ui.toast', (_: unknown, e: unknown) => {
    toasts.push(typeof e === 'string' ? e : JSON.stringify(e))
    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.settle()
  return { clock, submitted, toasts, loja }
}

async function bandText($: any): Promise<string | undefined> {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const found = await ui.find({ type: 'Text', text: /não salva/ })
  await ui.unmount()
  return found?.text
}

const OLD = T0 - 24 * 60 * MIN

test('pasta limpa não mostra a faixa, nem depois de 2 horas', async ($, on) => {
  const { clock } = await setup($, on, { isRepo: true, dirty: 0, ahead: 0, upstreamAt: T0 })
  await clock.advance(120 * MIN)
  expect(await bandText($)).toBe(undefined)
})

test('fora de um repositório git não mostra nada', async ($, on) => {
  const { clock } = await setup($, on, { isRepo: false, dirty: 0, ahead: 0, upstreamAt: 0 })
  await clock.advance(120 * MIN)
  expect(await bandText($)).toBe(undefined)
})

test('com trabalho não salvo, espera 1 hora antes de avisar', async ($, on) => {
  const { clock } = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: T0 })
  await clock.advance(30 * MIN)
  expect(await bandText($)).toBe(undefined)
  await clock.advance(31 * MIN)
  expect(await bandText($)).toBe('Faz 1h01 que você não salva · 3 arquivos fora do GitHub')
})

test('um arquivo só fica no singular', async ($, on) => {
  const { clock } = await setup($, on, { isRepo: true, dirty: 1, ahead: 0, upstreamAt: T0 })
  await clock.advance(100 * MIN)
  expect(await bandText($)).toBe('Faz 1h40 que você não salva · 1 arquivo fora do GitHub')
})

test('commit que não subiu também conta como não salvo', async ($, on) => {
  const { clock } = await setup($, on, { isRepo: true, dirty: 0, ahead: 2, upstreamAt: T0 })
  await clock.advance(61 * MIN)
  expect(await bandText($)).toBe('Faz 1h01 que você não salva · 2 commits sem enviar pro GitHub')
})

test('push de outro lugar (backup automático) zera o relógio', async ($, on) => {
  const repo = { isRepo: true, dirty: 3, ahead: 0, upstreamAt: T0 }
  const { clock } = await setup($, on, repo)
  await clock.advance(50 * MIN)
  repo.upstreamAt = T0 + 50 * MIN
  await clock.advance(20 * MIN)
  expect(await bandText($)).toBe(undefined)
})

test('Depois esconde por 30 minutos e a faixa volta', async ($, on) => {
  const { clock } = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: T0 })
  await clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'depois' })
  await ui.unmount()
  expect(await bandText($)).toBe(undefined)
  await clock.advance(31 * MIN)
  expect(await bandText($)).toBe('Faz 1h32 que você não salva · 3 arquivos fora do GitHub')
})

test('sem outras conversas abertas, Salvar agora roda o /salva e a faixa some', async ($, on) => {
  const { clock, submitted } = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: T0 })
  await clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'salvar' })
  await ui.unmount()
  await clock.settle()
  expect(submitted).toEqual(['salva lembrete'])
  expect(await bandText($)).toBe(undefined)
})

test('git push que deu certo mostra o aviso "Salvo no GitHub"', async ($, on) => {
  const repo = { isRepo: true, dirty: 3, ahead: 0, upstreamAt: T0 }
  const { clock, toasts } = await setup($, on, repo, on =>
    on('tool.call', () => {
      repo.dirty = 0
      repo.upstreamAt = T0 + 5 * MIN
      return { result: { stdout: 'ok', stderr: '', interrupted: false } }
    }),
  )
  await clock.advance(5 * MIN)
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  await clock.settle()
  expect(toasts.some(t => t.includes('Salvo no GitHub'))).toBe(true)
})

test('último envio pro GitHub foi ontem: avisa logo ao abrir', async ($, on) => {
  await setup($, on, { isRepo: true, dirty: 2, ahead: 0, upstreamAt: OLD })
  expect(await bandText($)).toBe('Faz 24h00 que você não salva · 2 arquivos fora do GitHub')
})

test('repositório sem GitHub ligado conta desde o início da sessão', async ($, on) => {
  const { clock } = await setup($, on, { isRepo: true, dirty: 2, ahead: 0, upstreamAt: 0 })
  await clock.advance(30 * MIN)
  expect(await bandText($)).toBe(undefined)
  await clock.advance(31 * MIN)
  expect(await bandText($)).toBe('Faz 1h01 que você não salva · 2 arquivos fora do GitHub')
})


test('se o /salva desta conversa falhar, avisa pra rodar à mão', async ($, on) => {
  // Antes do setup: o primeiro registrado fica por fora.
  on('command.run', { command: 'salva' }, () => {
    throw new Error('recusado')
  })
  const r = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: T0 })
  await r.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'salvar' })
  await ui.unmount()
  await r.clock.settle()
  expect(r.toasts.some(t => t.includes('Não consegui rodar o /salva nesta conversa. Rode à mão.'))).toBe(true)
})

// O que o ListAgents devolve: esta conversa é a [ee55]; duas outras no app (uma ocupada),
// uma na nuvem e uma desligada.
const LISTA = {
  listing: 'This session is Coordenadora [ee55]. The name other sessions use to reach it.',
  sections: [
    {
      kind: 'peers',
      total: 4,
      rows: [
        { name: 'Propostas', ref: 'aa11', type: 'interactive', status: 'idle' },
        { name: 'Conteúdo', ref: 'bb22', type: 'interactive', status: 'busy' },
        { name: 'Nuvem', ref: 'cc33', type: 'cloud', status: 'idle' },
        { name: 'Velha', ref: 'dd44', type: 'interactive', status: 'offline' },
      ],
    },
  ],
}

type Fila = {
  token: string
  coordenador: string
  fila: { ref: string; nome: string }[]
  atual: number
  estado: string
  ateAtual: number
  resultados: { conversa: string; resposta: string; motivo?: string }[]
}

// Uma conversa com o ListAgents ligado e nenhuma mensagem entre conversas.
function comLista(conta: { listou: number; enviados: string[] }, lista: unknown = LISTA) {
  return (on: any) => {
    on('tool.call', (_: unknown, e: { tool: string }) => {
      if (e.tool !== 'ListAgents') return { result: { stdout: '', stderr: '', interrupted: false } }
      conta.listou++
      return { result: lista }
    })
    on('session.send', (_: unknown, e: { to: string }) => {
      conta.enviados.push(e.to)
      return { isDelivered: true }
    })
  }
}

async function setupCoordenadora($: any, on: any) {
  const conta = { listou: 0, enviados: [] as string[] }
  const r = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: OLD }, comLista(conta))
  await r.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'salvar' })
  await ui.unmount()
  await r.clock.settle()
  const fila = () => r.loja.filaSalva as Fila | undefined
  return { ...r, ...conta, fila }
}

async function textoDaFaixa($: any): Promise<string | undefined> {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const found = await ui.find({ type: 'Text', text: /fila/ })
  await ui.unmount()
  return found?.text
}

async function pular($: any, vezes = 1) {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const cliques = Array.from({ length: vezes }, () => ui.press({ key: 'pular' }).catch(() => undefined))
  await Promise.all(cliques)
  await ui.unmount()
}

// Uma fila que outra conversa ([cc99]) começou; esta conversa é a [ee55].
function filaDeOutra(extra: Partial<Fila> = {}): Fila {
  return {
    token: 'SALVA-outra',
    coordenador: 'cc99',
    fila: [
      { ref: 'ee55', nome: 'Esta' },
      { ref: 'aa11', nome: 'Propostas' },
    ],
    atual: 0,
    estado: 'esperando',
    ateAtual: T0 + 5 * MIN,
    resultados: [],
    ...extra,
  }
}

async function setupNaFila($: any, on: any, repo: Repo, fila: Fila = filaDeOutra(), comandos = ['salva']) {
  const conta = { listou: 0, enviados: [] as string[] }
  const r = await setup($, on, repo, comLista(conta), { filaSalva: fila }, comandos)
  const atual = () => r.loja.filaSalva as Fila | undefined
  return { ...r, ...conta, atual }
}

const SUJO = { isRepo: true, dirty: 3, ahead: 0, upstreamAt: OLD }
const LIMPO = { isRepo: true, dirty: 0, ahead: 0, upstreamAt: T0 }
const FIM_DE_TURNO = { answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' as const }
// O /salva vira o prompt do comando, com a linha dos argumentos no fim.
const TURNO_DO_SALVA = { text: 'Salvar a sessão atual.\n\nARGUMENTS: lembrete', turnId: 't-salva' }

// ── Conversa que clicou em Salvar agora (coordena a fila) ──

test('Salvar agora monta a fila no store, sem mandar mensagem a ninguém', async ($, on) => {
  const { fila, enviados, submitted } = await setupCoordenadora($, on)
  const f = fila()
  expect(f?.coordenador).toBe('ee55')
  expect(f?.fila).toEqual([
    { ref: 'aa11', nome: 'Propostas' },
    { ref: 'bb22', nome: 'Conteúdo' },
  ])
  expect(f?.atual).toBe(0)
  expect(f?.estado).toBe('esperando')
  expect(enviados).toEqual([])
  expect(submitted).toEqual([])
  expect(await textoDaFaixa($)).toBe('Salvando em fila · 1 de 2 · agora: Propostas')
})

test('conversa da vez que não termina em 5 minutos fica sem resposta e a fila anda', async ($, on) => {
  const { clock, fila } = await setupCoordenadora($, on)
  await clock.advance(5 * MIN + 10_000)
  expect(fila()?.atual).toBe(1)
  expect(fila()?.resultados).toEqual([{ conversa: 'Propostas', resposta: 'sem resposta' }])
  expect(await textoDaFaixa($)).toBe('Salvando em fila · 2 de 2 · agora: Conteúdo')
})

test('fila no fim: esta conversa salva por último, resume e apaga a fila', async ($, on) => {
  const { clock, fila, loja, submitted, toasts } = await setupCoordenadora($, on)
  const f = fila() as Fila
  loja.filaSalva = {
    ...f,
    atual: 2,
    resultados: [
      { conversa: 'Propostas', resposta: 'pronto' },
      { conversa: 'Conteúdo', resposta: 'já salvo' },
    ],
  }
  await clock.advance(10_000)
  expect(submitted).toEqual(['salva lembrete'])
  expect(toasts.filter(t => t.includes('Salvamento em fila: 1 salva · 1 já estava salva')).length).toBe(1)
  expect(loja.filaSalva).toBe(undefined)
  expect(await textoDaFaixa($)).toBe(undefined)
})

test('o resumo diz quem ficou de fora e o motivo do erro', async ($, on) => {
  const { clock, fila, loja, toasts } = await setupCoordenadora($, on)
  const f = fila() as Fila
  loja.filaSalva = {
    ...f,
    fila: [...f.fila, { ref: 'x1', nome: 'B' }, { ref: 'x2', nome: 'C' }],
    atual: 4,
    resultados: [
      { conversa: 'Propostas', resposta: 'pronto' },
      { conversa: 'Conteúdo', resposta: 'sem salva aqui' },
      { conversa: 'B', resposta: 'erro', motivo: 'push recusado' },
      { conversa: 'C', resposta: 'pulada' },
    ],
  }
  await clock.advance(10_000)
  expect(
    toasts.some(t => t.includes('Salvamento em fila: 1 salva · 1 sem salva aqui · 1 erro: B (push recusado) · 1 pulada: C')),
  ).toBe(true)
})

test('Pular passa a vez da conversa atual', async ($, on) => {
  const { clock, fila } = await setupCoordenadora($, on)
  await pular($)
  await clock.settle()
  expect(fila()?.atual).toBe(1)
  expect(fila()?.resultados).toEqual([{ conversa: 'Propostas', resposta: 'pulada' }])
})

test('dois cliques em Pular na primeira conversa pulam uma só', async ($, on) => {
  const { clock, fila } = await setupCoordenadora($, on)
  await pular($, 2)
  await clock.settle()
  expect(fila()?.atual).toBe(1)
  expect(fila()?.resultados.length).toBe(1)
})

test('dois cliques em Pular na última conversa salvam esta uma vez só', async ($, on) => {
  const { clock, fila, loja, submitted, toasts } = await setupCoordenadora($, on)
  const f = fila() as Fila
  loja.filaSalva = { ...f, atual: 1, resultados: [{ conversa: 'Propostas', resposta: 'pronto' }] }
  await clock.advance(10_000)
  expect(await textoDaFaixa($)).toBe('Salvando em fila · 2 de 2 · agora: Conteúdo')
  await pular($, 2)
  await clock.advance(30_000)
  expect(submitted).toEqual(['salva lembrete'])
  expect(toasts.filter(t => t.includes('Salvamento em fila')).length).toBe(1)
})

test('dois cliques em Salvar agora começam uma fila só', async ($, on) => {
  const conta = { listou: 0, enviados: [] as string[] }
  const r = await setup($, on, SUJO, comLista(conta))
  await r.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await Promise.all([ui.press({ key: 'salvar' }), ui.press({ key: 'salvar' }).catch(() => undefined)])
  await ui.unmount()
  await r.clock.settle()
  expect(conta.listou).toBe(1)
  expect((r.loja.filaSalva as Fila | undefined)?.atual).toBe(0)
})

test('Salvar agora não faz nada se outra conversa começou uma fila depois do último desenho', async ($, on) => {
  const conta = { listou: 0, enviados: [] as string[] }
  const r = await setup($, on, SUJO, comLista(conta))
  await r.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  r.loja.filaSalva = filaDeOutra({ fila: [{ ref: 'aa11', nome: 'Propostas' }], ateAtual: T0 + 65 * MIN })
  await ui.press({ key: 'salvar' })
  await ui.unmount()
  await r.clock.settle()
  expect(conta.listou).toBe(0)
  expect((r.loja.filaSalva as Fila).token).toBe('SALVA-outra')
  expect(r.submitted).toEqual([])
})

test('sem outras conversas no app, salva na hora e não deixa fila', async ($, on) => {
  const conta = { listou: 0, enviados: [] as string[] }
  const r = await setup($, on, SUJO, comLista(conta, { listing: LISTA.listing, sections: [] }))
  await r.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'salvar' })
  await ui.unmount()
  await r.clock.settle()
  expect(r.submitted).toEqual(['salva lembrete'])
  expect(r.loja.filaSalva).toBe(undefined)
})

test('depois da última conversa, a faixa diz terminando e não oferece Pular', async ($, on) => {
  const { clock, fila, loja, submitted } = await setupCoordenadora($, on)
  const f = fila() as Fila
  loja.filaSalva = { ...f, atual: 2, estado: 'finalizando' }
  await clock.advance(10_000)
  expect(await textoDaFaixa($)).toBe('Salvando em fila · terminando')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  let recusado = false
  await ui.press({ key: 'pular' }).catch(() => {
    recusado = true
  })
  await ui.unmount()
  expect(recusado).toBe(true)
  expect(submitted).toEqual([])
})

test('fila presa em preparando é desfeita depois de 5 minutos', async ($, on) => {
  let solta: () => void = () => undefined
  const r = await setup($, on, SUJO, on => {
    on('tool.call', async (_: unknown, e: { tool: string }) => {
      if (e.tool === 'ListAgents') {
        // Quem pediu a lista foi cortado: a resposta não volta enquanto o teste não soltar.
        await new Promise<void>(res => {
          solta = res
        })
        return { result: LISTA }
      }
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
  })
  await r.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const clique = ui.press({ key: 'salvar' }).catch(() => undefined)
  await r.clock.advance(1000)
  expect(await textoDaFaixa($)).toBe('Salvando em fila · preparando')
  await r.clock.advance(6 * MIN)
  expect(r.loja.filaSalva).toBe(undefined)
  expect(await textoDaFaixa($)).toBe(undefined)
  solta()
  await clique
  await ui.unmount()
  await r.clock.settle()
  expect(r.submitted).toEqual([])
  expect(r.loja.filaSalva).toBe(undefined)
})

// ── Conversa que está na fila de outra ──

test('na vez desta conversa, com trabalho não salvo, roda o /salva lembrete uma vez', async ($, on) => {
  const { clock, submitted, atual, enviados } = await setupNaFila($, on, SUJO)
  await clock.advance(10_000)
  expect(submitted).toEqual(['salva lembrete'])
  expect(atual()?.estado).toBe('rodando')
  expect(atual()?.atual).toBe(0)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const aviso = await ui.find({ type: 'Text', text: /esta conversa/ })
  await ui.unmount()
  expect(aviso?.text).toBe('Salvando esta conversa (fila)')
  await clock.advance(60_000)
  expect(submitted).toEqual(['salva lembrete'])
  expect(enviados).toEqual([])
})

test('quando o turno do /salva termina, marca pronto e passa a vez', async ($, on) => {
  const { clock, atual } = await setupNaFila($, on, SUJO)
  await clock.advance(10_000)
  await $.turn.start(TURNO_DO_SALVA)
  await $.turn.complete({ ...FIM_DE_TURNO, turnId: 't-salva' })
  await clock.settle()
  expect(atual()?.atual).toBe(1)
  expect(atual()?.estado).toBe('esperando')
  expect(atual()?.resultados).toEqual([{ conversa: 'Esta', resposta: 'pronto' }])
})

test('fim de turno sem /salva da fila não mexe na fila', async ($, on) => {
  const { clock, atual } = await setupNaFila($, on, SUJO, filaDeOutra({ atual: 1 }))
  await clock.advance(10_000)
  await $.turn.complete(FIM_DE_TURNO)
  await clock.settle()
  expect(atual()?.atual).toBe(1)
  expect(atual()?.resultados).toEqual([])
})

test('pasta limpa, mas sem /salva nesta conversa na última hora: roda o /salva', async ($, on) => {
  // As conversas dividem o repositório: git limpo não quer dizer que esta já anotou as lições dela.
  const { clock, submitted, atual } = await setupNaFila($, on, LIMPO)
  await clock.advance(10_000)
  expect(submitted).toEqual(['salva lembrete'])
  expect(atual()?.estado).toBe('rodando')
})

// Esta conversa rodou o /salva `minutos` atrás e só então outra conversa começou a fila.
async function salvaHa($: any, on: any, minutos: number) {
  const conta = { listou: 0, enviados: [] as string[] }
  const r = await setup($, on, LIMPO, comLista(conta))
  await $.turn.start(TURNO_DO_SALVA)
  await $.turn.complete({ ...FIM_DE_TURNO, turnId: 't-salva' })
  await r.clock.advance(minutos * MIN)
  r.loja.filaSalva = filaDeOutra({ ateAtual: T0 + (minutos + 5) * MIN })
  await r.clock.advance(10_000)
  return { ...r, atual: () => r.loja.filaSalva as Fila | undefined }
}

test('/salva nesta conversa há 20 minutos: responde já salvo sem rodar', async ($, on) => {
  const { submitted, atual } = await salvaHa($, on, 20)
  expect(submitted).toEqual([])
  expect(atual()?.resultados).toEqual([{ conversa: 'Esta', resposta: 'já salvo' }])
})

test('/salva nesta conversa há 70 minutos: roda de novo', async ($, on) => {
  const { submitted, atual } = await salvaHa($, on, 70)
  expect(submitted).toEqual(['salva lembrete'])
  expect(atual()?.estado).toBe('rodando')
})

test('mensagem que só cita o /salva não conta como salvamento desta conversa', async ($, on) => {
  const conta = { listou: 0, enviados: [] as string[] }
  const r = await setup($, on, LIMPO, comLista(conta))
  await $.turn.start({ text: 'depois a gente roda o /salva, beleza?', turnId: 't-conversa' })
  await $.turn.complete({ ...FIM_DE_TURNO, turnId: 't-conversa' })
  await r.clock.advance(10 * MIN)
  r.loja.filaSalva = filaDeOutra({ ateAtual: T0 + 15 * MIN })
  await r.clock.advance(10_000)
  expect(r.submitted).toEqual(['salva lembrete'])
})

test('/salva digitado conta como salvamento desta conversa', async ($, on) => {
  const conta = { listou: 0, enviados: [] as string[] }
  const r = await setup($, on, LIMPO, comLista(conta))
  await $.turn.start({ text: '<command-name>/salva</command-name>\n# /salva — Salvar progresso', turnId: 't-manual' })
  await $.turn.complete({ ...FIM_DE_TURNO, turnId: 't-manual' })
  await r.clock.advance(10 * MIN)
  r.loja.filaSalva = filaDeOutra({ ateAtual: T0 + 15 * MIN })
  await r.clock.advance(10_000)
  expect(r.submitted).toEqual([])
  expect((r.loja.filaSalva as any)?.resultados).toEqual([{ conversa: 'Esta', resposta: 'já salvo' }])
})

test('fora de um repositório git responde sem salva aqui', async ($, on) => {
  const { clock, submitted, atual } = await setupNaFila($, on, { isRepo: false, dirty: 0, ahead: 0, upstreamAt: 0 })
  await clock.advance(10_000)
  expect(submitted).toEqual([])
  expect(atual()?.resultados).toEqual([{ conversa: 'Esta', resposta: 'sem salva aqui' }])
})

test('sem o comando salva na pasta responde sem salva aqui', async ($, on) => {
  const { clock, submitted, atual } = await setupNaFila($, on, SUJO, filaDeOutra(), ['review'])
  await clock.advance(10_000)
  expect(submitted).toEqual([])
  expect(atual()?.resultados).toEqual([{ conversa: 'Esta', resposta: 'sem salva aqui' }])
})

test('se o /salva não começa, a vez fecha com erro e o motivo', async ($, on) => {
  on('command.run', { command: 'salva' }, () => {
    throw new Error('recusado')
  })
  const { clock, atual } = await setupNaFila($, on, SUJO)
  await clock.advance(10_000)
  const r = atual()?.resultados[0]
  expect(r?.resposta).toBe('erro')
  // O kit entrega o erro do gancho com o texto dele, não o 'recusado' do teste.
  expect(typeof r?.motivo === 'string' && r.motivo.length > 0).toBe(true)
  expect(atual()?.atual).toBe(1)
})

test('fila de outra conversa: a faixa avisa e não oferece Salvar agora', async ($, on) => {
  const { clock } = await setupNaFila(
    $,
    on,
    SUJO,
    filaDeOutra({ fila: [{ ref: 'aa11', nome: 'Propostas' }, { ref: 'ee55', nome: 'Esta' }], ateAtual: T0 + 70 * MIN }),
  )
  await clock.advance(MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const aviso = await ui.find({ type: 'Text', text: /outra conversa/ })
  await ui.unmount()
  expect(aviso?.text).toBe('Salvamento em fila rodando em outra conversa')
  expect(await bandText($)).toBe(undefined)
})

test('fila abandonada há mais de 15 minutos é apagada e a faixa volta', async ($, on) => {
  const { clock, loja } = await setupNaFila(
    $,
    on,
    SUJO,
    filaDeOutra({ fila: [{ ref: 'aa11', nome: 'Propostas' }], ateAtual: T0 - 16 * MIN }),
  )
  await clock.advance(10_000)
  expect(loja.filaSalva).toBe(undefined)
  expect(await bandText($)).toBe('Faz 24h00 que você não salva · 3 arquivos fora do GitHub')
})

test('marca e rodada da versão anterior são ignoradas', async ($, on) => {
  // O que a v0.3 guardou: a marca filaAtiva no store e a rodada no estado.
  on('state.get', (_: unknown, e: any, next: any) =>
    e?.key === 'rodada'
      ? { value: { value: { token: 'SALVA-velho', fila: ['Propostas [aa11]'], atual: 0, resultados: [], ateAtual: T0 }, version: 1 } }
      : next(e),
  )
  const { clock } = await setup($, on, SUJO, undefined, { filaAtiva: { token: 'SALVA-velho', ate: T0 + 60 * MIN } })
  await clock.advance(MIN)
  expect(await textoDaFaixa($)).toBe(undefined)
  expect(await bandText($)).toBe('Faz 24h01 que você não salva · 3 arquivos fora do GitHub')
})

test('turno que termina antes do turno do /salva começar não marca pronto', async ($, on) => {
  const { clock, atual } = await setupNaFila($, on, SUJO)
  await clock.advance(10_000)
  await $.turn.complete({ ...FIM_DE_TURNO, turnId: 't-antigo' })
  await clock.settle()
  expect(atual()?.atual).toBe(0)
  expect(atual()?.estado).toBe('rodando')
  // E o turno do /salva, que vem depois, ainda fecha a vez.
  await $.turn.start(TURNO_DO_SALVA)
  await $.turn.complete({ ...FIM_DE_TURNO, turnId: 't-salva' })
  await clock.settle()
  expect(atual()?.resultados).toEqual([{ conversa: 'Esta', resposta: 'pronto' }])
})

test('turno de subagente com o texto do /salva é ignorado', async ($, on) => {
  const { clock, atual } = await setupNaFila($, on, SUJO)
  await clock.advance(10_000)
  await $.turn.start({ ...TURNO_DO_SALVA, turnId: 't-sub', agentId: 'ag1' })
  await $.turn.complete({ ...FIM_DE_TURNO, turnId: 't-sub', agentId: 'ag1' })
  await clock.settle()
  expect(atual()?.atual).toBe(0)
  expect(atual()?.estado).toBe('rodando')
})

test('turno do /salva interrompido fecha a vez com erro', async ($, on) => {
  const { clock, atual } = await setupNaFila($, on, SUJO)
  await clock.advance(10_000)
  await $.turn.start(TURNO_DO_SALVA)
  await $.turn.complete({ ...FIM_DE_TURNO, turnId: 't-salva', isAborted: true, reason: 'aborted' as const })
  await clock.settle()
  expect(atual()?.resultados).toEqual([{ conversa: 'Esta', resposta: 'erro', motivo: 'o /salva foi interrompido' }])
  expect(atual()?.atual).toBe(1)
})

test('enquanto o /salva desta conversa roda, o prazo dela não vence (sinal de vida a cada 5 s)', async ($, on) => {
  const { clock, atual } = await setupNaFila($, on, SUJO)
  await clock.advance(10_000)
  expect(atual()?.estado).toBe('rodando')
  await clock.advance(10 * MIN)
  expect(atual()?.estado).toBe('rodando')
  expect((atual()?.ateAtual ?? 0) > T0 + 10 * MIN).toBe(true)
})

test('quem coordena não pula a conversa que segue dando sinal de vida', async ($, on) => {
  const { clock, fila, loja } = await setupCoordenadora($, on)
  const f = fila() as Fila
  loja.filaSalva = { ...f, estado: 'rodando' }
  // A outra conversa renova o prazo a cada minuto, por 10 minutos.
  for (let i = 0; i < 10; i++) {
    await clock.advance(MIN)
    const agora = T0 + 61 * MIN + (i + 1) * MIN
    loja.filaSalva = { ...(loja.filaSalva as Fila), ateAtual: agora + 5 * MIN }
  }
  await clock.advance(10_000)
  expect(fila()?.atual).toBe(0)
  expect(fila()?.estado).toBe('rodando')
})

test('quem coordena pula a conversa que parou de dar sinal de vida depois de 5 minutos', async ($, on) => {
  const { clock, fila, loja } = await setupCoordenadora($, on)
  const f = fila() as Fila
  loja.filaSalva = { ...f, estado: 'rodando' }
  await clock.advance(5 * MIN + 10_000)
  expect(fila()?.atual).toBe(1)
  expect(fila()?.resultados).toEqual([{ conversa: 'Propostas', resposta: 'sem resposta' }])
})
