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

async function setup($: any, on: any, repo: Repo, extra?: (on: any) => void, loja?: Record<string, unknown>) {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on, loja)
  fakeGit(on, repo)
  const submitted: string[] = []
  const toasts: string[] = []
  on('command.run', (_: unknown, e: { command: string; args?: string }) => {
    submitted.push(e.args ? `${e.command} ${e.args}` : e.command)
    return { text: '' }
  })
  // Embaixo do mod, o desenho do próprio Claude: uma caixa vazia.
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('session.receive', (_: unknown, e: { text: string }) => ({ text: e.text }))
  // O endereço desta conversa no app (para onde as outras respondem).
  on('env.get', (_: unknown, e: { name: string }) => ({
    value: e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_coordenadora' : undefined,
  }))
  on('session.id', () => ({ value: 'cli-esta' }))
  extra?.(on)
  on('ui.toast', (_: unknown, e: unknown) => {
    toasts.push(typeof e === 'string' ? e : JSON.stringify(e))
    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.settle()
  return { clock, submitted, toasts }
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

// Conversas abertas que o ListAgents devolve: duas no app (uma ocupada), uma na nuvem e uma desligada.
const LISTA = {
  listing: '',
  sections: [
    {
      kind: 'peers',
      total: 4,
      rows: [
        { name: 'Propostas', ref: 'aa11', type: 'Claude Desktop session', status: 'idle' },
        { name: 'Conteúdo', ref: 'bb22', type: 'Claude Desktop session', status: 'busy' },
        { name: 'Nuvem', ref: 'cc33', type: 'cloud', status: 'idle' },
        { name: 'Velha', ref: 'dd44', type: 'Remote Control', status: 'offline' },
      ],
    },
  ],
}


async function setupRodada($: any, on: any, entregue: (to: string) => boolean = () => true) {
  const enviados: { to: string; text: string }[] = []
  const r = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: OLD }, on => {
    on('tool.call', (_: unknown, e: { tool: string }) =>
      e.tool === 'ListAgents' ? { result: LISTA } : { result: { stdout: '', stderr: '', interrupted: false } },
    )
    on('session.send', (_: unknown, e: { to: string; text: string }) => {
      enviados.push({ to: e.to, text: e.text })
      return entregue(e.to) ? { isDelivered: true } : { isDelivered: false, reason: 'conversa fechada' }
    })
  })
  await r.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'salvar' })
  await ui.unmount()
  await r.clock.settle()
  const base = (enviados[0]?.text.match(/SALVA-[a-z0-9]+/) ?? [''])[0]
  return { ...r, enviados, base }
}

async function textoDaFaixa($: any): Promise<string | undefined> {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const found = await ui.find({ type: 'Text', text: /fila/ })
  await ui.unmount()
  return found?.text
}

// Só os pedidos: os avisos de cancelamento ficam de fora.
function pedidos(enviados: { to: string; text: string }[]) {
  return enviados.filter(x => !/^SALVA-[a-z0-9]+-\d+ cancelado:/.test(x.text))
}

function responder($: any, codigo: string, texto: string) {
  return $.session.receive({ origin: { kind: 'peer-send-message' }, text: `${codigo}: ${texto}` })
}

test('Salvar agora pede só à primeira conversa da fila e espera', async ($, on) => {
  const { enviados, submitted, base } = await setupRodada($, on)
  expect(enviados.map(x => x.to)).toEqual(['Propostas [aa11]'])
  expect(enviados[0]?.text).toContain(`${base}-0`)
  expect(enviados[0]?.text).toContain('/salva lembrete')
  expect(enviados[0]?.text).toContain('já salvo')
  expect(enviados[0]?.text).toContain('sem salva aqui')
  expect(submitted).toEqual([])
  expect(await textoDaFaixa($)).toBe('Salvando em fila · 1 de 2 · agora: Propostas')
})

test('a próxima conversa só recebe o pedido depois que a anterior responde', async ($, on) => {
  const { clock, enviados, base } = await setupRodada($, on)
  const r1 = await responder($, `${base}-0`, 'pronto')
  expect(JSON.stringify(r1)).toContain('consumed')
  await clock.settle()
  expect(enviados.map(x => x.to)).toEqual(['Propostas [aa11]', 'Conteúdo [bb22]'])
  expect(enviados[1]?.text).toContain(`${base}-1`)
  expect(await textoDaFaixa($)).toBe('Salvando em fila · 2 de 2 · agora: Conteúdo')
})

test('acabada a fila, esta conversa salva por último e mostra o resumo', async ($, on) => {
  const { clock, submitted, toasts, base } = await setupRodada($, on)
  await responder($, `${base}-0`, 'pronto')
  await clock.settle()
  expect(submitted).toEqual([])
  await responder($, `${base}-1`, 'já salvo')
  await clock.settle()
  expect(submitted).toEqual(['salva lembrete'])
  expect(toasts.some(t => t.includes('Salvamento em fila: 1 salva · 1 já estava salva'))).toBe(true)
  expect(await textoDaFaixa($)).toBe(undefined)
})

test('"sem salva aqui" avança sem contar como salva', async ($, on) => {
  const { clock, toasts, base } = await setupRodada($, on)
  await responder($, `${base}-0`, 'sem salva aqui')
  await clock.settle()
  await responder($, `${base}-1`, 'pronto')
  await clock.settle()
  expect(toasts.some(t => t.includes('Salvamento em fila: 1 salva · 1 sem salva aqui'))).toBe(true)
})

test('5 minutos sem resposta pula pra próxima e o resumo diz qual', async ($, on) => {
  const { clock, enviados, submitted, toasts, base } = await setupRodada($, on)
  await clock.advance(5 * MIN + 1000)
  expect(pedidos(enviados).map(x => x.to)).toEqual(['Propostas [aa11]', 'Conteúdo [bb22]'])
  await responder($, `${base}-1`, 'pronto')
  await clock.settle()
  expect(submitted).toEqual(['salva lembrete'])
  expect(toasts.some(t => t.includes('1 salva · 1 sem resposta: Propostas'))).toBe(true)
})

test('resposta atrasada da conversa pulada não conta pra conversa da vez', async ($, on) => {
  const { clock, submitted, base } = await setupRodada($, on)
  await clock.advance(5 * MIN + 1000)
  const r = await responder($, `${base}-0`, 'pronto')
  expect(JSON.stringify(r)).toContain('consumed')
  await clock.settle()
  expect(submitted).toEqual([])
  expect(await textoDaFaixa($)).toBe('Salvando em fila · 2 de 2 · agora: Conteúdo')
})

test('pedido que não chega pula direto pra próxima', async ($, on) => {
  const { enviados, base } = await setupRodada($, on, to => to !== 'Propostas [aa11]')
  expect(enviados.map(x => x.to)).toEqual(['Propostas [aa11]', 'Conteúdo [bb22]'])
  expect(enviados[1]?.text).toContain(`${base}-1`)
  expect(await textoDaFaixa($)).toBe('Salvando em fila · 2 de 2 · agora: Conteúdo')
})

test('Pular esta conversa passa pra próxima e entra no resumo', async ($, on) => {
  const { clock, enviados, toasts, base } = await setupRodada($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'pular' })
  await ui.unmount()
  await clock.settle()
  expect(pedidos(enviados).map(x => x.to)).toEqual(['Propostas [aa11]', 'Conteúdo [bb22]'])
  await responder($, `${base}-1`, 'pronto')
  await clock.settle()
  expect(toasts.some(t => t.includes('1 pulada: Propostas'))).toBe(true)
})

test('mensagem de outra conversa sem o código passa direto pro Claude', async ($, on) => {
  await setupRodada($, on)
  const r = await $.session.receive({ origin: { kind: 'peer-send-message' }, text: 'oi, terminei a proposta' })
  expect(JSON.stringify(r)).not.toContain('consumed')
})

test('rodada guardada pela versão anterior é ignorada', async ($, on) => {
  // O que a v1 guardou (sem fila) continua no estado depois da troca de código.
  on('state.get', (_: unknown, e: any, next: any) =>
    e?.key === 'rodada'
      ? { value: { value: { token: 'SALVA-velho', pedidas: ['Propostas [aa11]'], respostas: [], ate: T0 }, version: 1 } }
      : next(e),
  )
  const { clock } = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: OLD })
  await clock.advance(MIN)
  expect(await textoDaFaixa($)).toBe(undefined)
  expect(await bandText($)).toBe('Faz 24h01 que você não salva · 3 arquivos fora do GitHub')
})

test('com fila rodando em outra conversa, a faixa não oferece Salvar agora', async ($, on) => {
  // O $ do teste não tem $.store: a marca da outra conversa já está no store desde o início.
  const { clock } = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: OLD }, undefined, {
    filaAtiva: { token: 'SALVA-outra', ate: T0 + 3 * MIN },
  })
  await clock.advance(MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const aviso = await ui.find({ type: 'Text', text: /outra conversa/ })
  await ui.unmount()
  expect(aviso?.text).toBe('Salvamento em fila rodando em outra conversa')
  expect(await bandText($)).toBe(undefined)
  await clock.advance(3 * MIN)
  expect(await bandText($)).toBe('Faz 24h04 que você não salva · 3 arquivos fora do GitHub')
})

test('dois cliques em Pular na primeira conversa mandam o pedido da próxima uma vez só', async ($, on) => {
  const { clock, enviados } = await setupRodada($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const a = ui.press({ key: 'pular' })
  const b = ui.press({ key: 'pular' }).catch(() => undefined)
  await a
  await b
  await ui.unmount()
  await clock.settle()
  expect(pedidos(enviados).map(x => x.to)).toEqual(['Propostas [aa11]', 'Conteúdo [bb22]'])
})

test('dois cliques em Pular na última conversa salvam esta uma vez só', async ($, on) => {
  const { clock, submitted, toasts, base } = await setupRodada($, on)
  await responder($, `${base}-0`, 'pronto')
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const a = ui.press({ key: 'pular' })
  const b = ui.press({ key: 'pular' }).catch(() => undefined)
  await a
  await b
  await ui.unmount()
  await clock.settle()
  expect(submitted).toEqual(['salva lembrete'])
  expect(toasts.filter(t => t.includes('Salvamento em fila')).length).toBe(1)
})

test('resposta junto com o prazo não pula duas conversas', async ($, on) => {
  const { clock, enviados, submitted, base } = await setupRodada($, on)
  await clock.advance(5 * MIN - 1)
  const p = responder($, `${base}-0`, 'pronto')
  await clock.advance(1000)
  await p
  await clock.settle()
  expect(pedidos(enviados).map(x => x.to)).toEqual(['Propostas [aa11]', 'Conteúdo [bb22]'])
  expect(submitted).toEqual([])
})

test('dois cliques em Salvar agora começam uma fila só', async ($, on) => {
  const enviados: { to: string; text: string }[] = []
  const r = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: OLD }, on => {
    on('tool.call', (_: unknown, e: { tool: string }) =>
      e.tool === 'ListAgents' ? { result: LISTA } : { result: { stdout: '', stderr: '', interrupted: false } },
    )
    on('session.send', (_: unknown, e: { to: string; text: string }) => {
      enviados.push({ to: e.to, text: e.text })
      return { isDelivered: true }
    })
  })
  await r.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const a = ui.press({ key: 'salvar' })
  const b = ui.press({ key: 'salvar' }).catch(() => undefined)
  await a
  await b
  await ui.unmount()
  await r.clock.settle()
  expect(pedidos(enviados).map(x => x.to)).toEqual(['Propostas [aa11]'])
  expect(r.submitted).toEqual([])
})

test('Salvar agora não faz nada se outra conversa marcou uma fila depois do último desenho', async ($, on) => {
  let marca: unknown = undefined
  on('store.get', { key: 'filaAtiva' }, (_: unknown, e: { key: string }, next: any) =>
    e.key === 'filaAtiva' && marca ? { value: marca } : next(e),
  )
  const enviados: string[] = []
  let listou = 0
  const r = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: OLD }, on => {
    on('tool.call', (_: unknown, e: { tool: string }) => {
      if (e.tool === 'ListAgents') listou++
      return e.tool === 'ListAgents' ? { result: LISTA } : { result: { stdout: '', stderr: '', interrupted: false } }
    })
    on('session.send', (_: unknown, e: { to: string }) => {
      enviados.push(e.to)
      return { isDelivered: true }
    })
  })
  await r.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  marca = { token: 'SALVA-outra', ate: T0 + 70 * MIN }
  await ui.press({ key: 'salvar' })
  await ui.unmount()
  await r.clock.settle()
  expect(listou).toBe(0)
  expect(enviados).toEqual([])
  expect(r.submitted).toEqual([])
})

test('a conversa que coordena marca a fila no store ao começar e limpa no fim', async ($, on) => {
  const escritas: { key: string; value: unknown }[] = []
  on('store.set', { key: 'filaAtiva' }, (_: unknown, e: { key: string; value: unknown }, next: any) => {
    if (e.key === 'filaAtiva') escritas.push({ key: e.key, value: e.value })
    return next(e)
  })
  const { clock, base } = await setupRodada($, on)
  const primeira = escritas[0]?.value as { token?: string } | undefined
  expect(primeira?.token).toBe(base)
  await responder($, `${base}-0`, 'pronto')
  await clock.settle()
  await responder($, `${base}-1`, 'pronto')
  await clock.settle()
  expect(escritas[escritas.length - 1]?.value).toBe(null)
})

test('conversa que passou do prazo recebe o aviso de cancelamento', async ($, on) => {
  const { clock, enviados, base } = await setupRodada($, on)
  await clock.advance(5 * MIN + 1000)
  const cancelamento = enviados.find(x => x.text.startsWith(`${base}-0 cancelado:`))
  expect(cancelamento?.to).toBe('Propostas [aa11]')
  expect(cancelamento?.text).toBe(
    `${base}-0 cancelado: não rode o /salva agora; o que você tem fica para o próximo salvamento.`,
  )
})

test('o pedido diz como cancelar e para onde responder', async ($, on) => {
  const { enviados, base } = await setupRodada($, on)
  expect(enviados[0]?.text).toContain(`${base}-0 cancelado`)
  expect(enviados[0]?.text).toContain('SendMessage')
  expect(enviados[0]?.text).toContain('local_coordenadora')
})

test('resposta atrasada depois do fim da fila não chega ao Claude', async ($, on) => {
  const { clock, base } = await setupRodada($, on)
  await responder($, `${base}-0`, 'pronto')
  await clock.settle()
  await responder($, `${base}-1`, 'pronto')
  await clock.settle()
  const r = await responder($, `${base}-0`, 'pronto')
  expect(JSON.stringify(r)).toContain('consumed')
})

test('o pedido que chega de outra conversa não é engolido', async ($, on) => {
  await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: OLD })
  const texto = 'SALVA-abc-0 Pedido automático do lembrete do salva: responda só "SALVA-abc-0: pronto".'
  const r = await $.session.receive({ origin: { kind: 'peer-send-message' }, text: texto })
  expect(JSON.stringify(r)).not.toContain('consumed')
})

test('"sem erros" conta como pronto, erro guarda o motivo e o resto é resposta estranha', async ($, on) => {
  const enviados: { to: string; text: string }[] = []
  const lista = {
    listing: '',
    sections: [
      {
        kind: 'peers',
        total: 3,
        rows: [
          { name: 'A', ref: 'a1', type: 'Claude Desktop session', status: 'idle' },
          { name: 'B', ref: 'b2', type: 'Claude Desktop session', status: 'idle' },
          { name: 'C', ref: 'c3', type: 'Claude Desktop session', status: 'idle' },
        ],
      },
    ],
  }
  const r = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: OLD }, on => {
    on('tool.call', (_: unknown, e: { tool: string }) =>
      e.tool === 'ListAgents' ? { result: lista } : { result: { stdout: '', stderr: '', interrupted: false } },
    )
    on('session.send', (_: unknown, e: { to: string; text: string }) => {
      enviados.push({ to: e.to, text: e.text })
      return { isDelivered: true }
    })
  })
  await r.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'salvar' })
  await ui.unmount()
  await r.clock.settle()
  const base = (enviados[0]?.text.match(/SALVA-[a-z0-9]+/) ?? [''])[0]
  await responder($, `${base}-0`, 'pronto, sem erros')
  await r.clock.settle()
  await responder($, `${base}-1`, 'erro push recusado')
  await r.clock.settle()
  await responder($, `${base}-2`, 'hum, não entendi')
  await r.clock.settle()
  expect(
    r.toasts.some(t =>
      t.includes('Salvamento em fila: 1 salva · 1 erro: B (push recusado) · 1 resposta estranha: C'),
    ),
  ).toBe(true)
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

test('relógio de 1 minuto não vence o prazo da próxima enquanto o pedido dela ainda está saindo', async ($, on) => {
  const enviados: { to: string; text: string }[] = []
  let primeiraConteudo = true
  let solta: () => void = () => undefined
  const r = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: OLD }, on => {
    on('tool.call', (_: unknown, e: { tool: string }) =>
      e.tool === 'ListAgents' ? { result: LISTA } : { result: { stdout: '', stderr: '', interrupted: false } },
    )
    on('session.send', async (_: unknown, e: { to: string; text: string }) => {
      enviados.push({ to: e.to, text: e.text })
      // O pedido da Conteúdo fica saindo até o teste soltar.
      if (e.to.startsWith('Conteúdo') && primeiraConteudo) {
        primeiraConteudo = false
        await new Promise<void>(res => {
          solta = res
        })
      }
      return { isDelivered: true }
    })
  })
  await r.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'salvar' })
  await ui.unmount()
  await r.clock.settle()
  await r.clock.advance(5 * MIN + 1000)
  await r.clock.advance(2 * MIN)
  solta()
  await r.clock.settle()
  expect(pedidos(enviados).map(x => x.to)).toEqual(['Propostas [aa11]', 'Conteúdo [bb22]'])
  expect(r.submitted).toEqual([])
  await r.clock.advance(10 * MIN)
  await r.clock.settle()
  expect(r.submitted).toEqual(['salva lembrete'])
  expect(r.toasts.filter(t => t.includes('Salvamento em fila')).length).toBe(1)
})

test('depois da última conversa, a faixa diz terminando e não oferece Pular', async ($, on) => {
  // Estado entre resolver a última conversa e o fim da fila, guardado aqui no teste (leitura e escrita).
  const caixa: { value: unknown; version: number } = {
    value: {
      token: 'SALVA-fim',
      fila: ['Propostas [aa11]'],
      atual: 1,
      resultados: [{ conversa: 'Propostas [aa11]', resposta: 'pronto' }],
      ateAtual: 0,
    },
    version: 1,
  }
  on('state.get', (_: unknown, e: any, next: any) =>
    e?.key === 'rodada' ? { value: { value: caixa.value, version: caixa.version } } : next(e),
  )
  on('state.set', (_: unknown, e: any, next: any) => {
    if (e?.key !== 'rodada') return next(e)
    if (e.ifVersion !== undefined && e.ifVersion !== caixa.version) return { value: { isSet: false, version: caixa.version } }
    caixa.value = e.value
    caixa.version++
    return { value: { isSet: true, version: caixa.version } }
  })
  const { clock, submitted } = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: OLD })
  await clock.advance(MIN)
  expect(await textoDaFaixa($)).toBe('Salvando em fila · terminando')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  let recusado = false
  await ui.press({ key: 'pular' }).catch(() => {
    recusado = true
  })
  await ui.unmount()
  expect(recusado).toBe(true)
  // Uma resposta com o código da posição depois da última também não passa a vez de novo.
  await responder($, 'SALVA-fim-1', 'pronto')
  await clock.settle()
  expect(submitted).toEqual([])
  expect((caixa.value as { atual: number }).atual).toBe(1)
})

test('fila presa em preparando é desfeita pelo relógio depois de 5 minutos', async ($, on) => {
  let solta: () => void = () => undefined
  const escritas: unknown[] = []
  on('store.set', { key: 'filaAtiva' }, (_: unknown, e: { key: string; value: unknown }, next: any) => {
    escritas.push(e.value)
    return next(e)
  })
  const r = await setup($, on, { isRepo: true, dirty: 3, ahead: 0, upstreamAt: OLD }, on => {
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
    on('session.send', () => ({ isDelivered: true }))
  })
  await r.clock.advance(61 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const clique = ui.press({ key: 'salvar' }).catch(() => undefined)
  await r.clock.advance(1000)
  expect(await textoDaFaixa($)).toBe('Salvando em fila · preparando')
  await r.clock.advance(6 * MIN)
  expect(await textoDaFaixa($)).toBe(undefined)
  expect(escritas[escritas.length - 1]).toBe(null)
  solta()
  await clique
  await ui.unmount()
  await r.clock.settle()
  expect(r.submitted).toEqual([])
})

test('sem o endereço do app, o pedido usa o id da sessão', async ($, on) => {
  // Antes do setup: o primeiro registrado fica por fora.
  on('env.get', { name: 'CLAUDE_CODE_HOST_SESSION_ID' }, () => ({ value: '' }))
  const { enviados } = await setupRodada($, on)
  expect(enviados[0]?.text).toContain('"cli-esta"')
})
