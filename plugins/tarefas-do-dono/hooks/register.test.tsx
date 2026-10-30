import { expect, mock, test } from 'claude-code/testing'


const MIN = 60_000
const T0 = Date.UTC(2026, 9, 27, 20, 0)
const TOOL = 'mcp__tarefas-do-dono__anotar_tarefa'

const PANE = {
  plugin: 'tarefas-do-dono',
  component: 'Pane',
  requestId: 'tarefas',
  props: {
    title: 'Suas tarefas',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const HOME = '/Users/dono'
const CONTA = 'conta-1'
const ORG = 'org-1'
const ESTA = 'local_esta'
const pasta = (sessao: string) =>
  `${HOME}/Library/Application Support/Claude/claude-code-sessions/${CONTA}/${ORG}/${sessao}.json`

type Opcoes = { sessao?: string; conversas?: Record<string, { title?: string; isArchived?: boolean }> }

// O store de mentira é um objeto comum: mudar ele à mão faz o papel de outra conversa.
async function setup($: any, on: any, store: Record<string, unknown> = {}, opcoes: Opcoes = {}) {
  const clock = mock.clock(on, { now: T0 })
  const sessao = 'sessao' in opcoes ? opcoes.sessao : ESTA
  const env: Record<string, string | undefined> = {
    HOME,
    CLAUDE_CODE_ACCOUNT_UUID: CONTA,
    CLAUDE_CODE_ORGANIZATION_UUID: ORG,
    CLAUDE_CODE_HOST_SESSION_ID: sessao,
  }
  on('env.get', (_: unknown, e: { name: string }) => ({ value: env[e.name] }))
  on('session.id', () => ({ value: 'cli-esta' }))
  on('session.cwd', () => ({ value: '/Users/dono/minha-empresa' }))
  const arquivos: Record<string, string> = {}
  for (const [id, c] of Object.entries(opcoes.conversas ?? {})) arquivos[pasta(id)] = JSON.stringify({ sessionId: id, ...c })
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (!(e.path in arquivos)) throw new Error('ENOENT')
    return { value: arquivos[e.path] }
  })
  const rodados: string[][] = []
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    rodados.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  const enviados: string[] = []
  on('prompt.submit', (_: unknown, e: { text: string }) => {
    enviados.push(e.text)
    return { text: e.text }
  })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  const toasts: string[] = []
  const opened: string[] = []
  on('ui.toast', (_: unknown, e: unknown) => {
    toasts.push(typeof e === 'string' ? e : String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('ui.open', (_: unknown, e: { id: string }) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('command.register', () => ({ value: { command: 'tarefas' } }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/Users/dono/minha-empresa', surface: 'desktop', isInteractive: true })
  await clock.settle()
  return { clock, toasts, opened, rodados, enviados }
}

async function textos($: any): Promise<string[]> {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return all.map((t: { text: string }) => t.text)
}

test('lista vazia mostra a frase', async ($, on) => {
  await setup($, on)
  expect(await textos($)).toContain('Nada esperando você.')
})

test('o Claude anota pela ferramenta e a tarefa aparece no painel', async ($, on) => {
  const { toasts } = await setup($, on)
  const r = await $.tool.call({ tool: TOOL, texto: 'Aprovar o orçamento da cozinha' })
  expect(JSON.stringify(r)).toContain('anotada')
  const t = await textos($)
  expect(t).toContain('Aprovar o orçamento da cozinha')
  expect(t.some(x => x.includes('minha-empresa'))).toBe(true)
  expect(toasts.some(x => x.includes('Tarefa nova pra você: Aprovar o orçamento da cozinha'))).toBe(true)
})

test('o dono anota pelo campo do painel', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'nova', text: 'Ligar pro contador' })
  await ui.unmount()
  expect(await textos($)).toContain('Ligar pro contador')
})

test('Feito tira da lista e conta nas feitas de hoje', async ($, on) => {
  const { clock } = await setup($, on)
  await $.tool.call({ tool: TOOL, texto: 'Mandar o documento do seguro' })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const botao = await ui.find({ type: 'Button', label: 'Feito' })
  await ui.press({ key: botao.key })
  await ui.unmount()
  const t = await textos($)
  expect(t).not.toContain('Mandar o documento do seguro')
  expect(t).toContain('1 feita hoje')
})

test('a lista é a mesma em outra conversa (vem do store)', async ($, on) => {
  const guardada = [{ id: 'a1', texto: 'Trocar a senha do banco', origem: 'outra-pasta', criadaEm: T0 - 120 * MIN }]
  const { toasts, opened } = await setup($, on, { tarefas: guardada })
  const t = await textos($)
  expect(t).toContain('Trocar a senha do banco')
  expect(t.some(x => x.includes('outra-pasta') && x.includes('há 2 h'))).toBe(true)
  expect(toasts).toContain('1 tarefa esperando você')
  expect(opened).toContain('tarefas')
})

test('tarefa anotada em outra conversa aparece aqui na próxima conferência', async ($, on) => {
  const store: Record<string, unknown> = {}
  const { clock } = await setup($, on, store)
  store.tarefas = [{ id: 'b1', texto: 'Assinar o contrato', origem: 'vendas', criadaEm: T0 }]
  await clock.advance(31_000)
  expect(await textos($)).toContain('Assinar o contrato')
})

test('sem pendência não abre o painel nem avisa', async ($, on) => {
  const { toasts, opened } = await setup($, on)
  expect(toasts).toEqual([])
  expect(opened).toEqual([])
})

test('o comando tarefas abre o painel', async ($, on) => {
  const { opened } = await setup($, on)
  await $.command.run({ command: 'tarefas' })
  expect(opened).toContain('tarefas')
})

test('o campo de anotar diz pra que serve', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const campo = await ui.find({ type: 'Input', key: 'nova' })
  await ui.unmount()
  expect(campo.props.placeholder).toBe('Escreva algo que só você pode fazer')
  expect(campo.props.submitLabel).toBe('Adicionar')
})

test('a ferramenta guarda o pedido e a conversa que anotou', async ($, on) => {
  const store: Record<string, unknown> = {}
  await setup($, on, store)
  await $.tool.call({ tool: TOOL, texto: 'Aprovar a copy da live', prompt: 'Revise a copy da live e publique' })
  const [t] = store.tarefas as Array<Record<string, unknown>>
  expect(t.prompt).toBe('Revise a copy da live e publique')
  expect(t.sessao).toBe(ESTA)
  expect(t.origem).toBe('minha-empresa')
})

test('o card mostra o título da conversa de origem no lugar da pasta', async ($, on) => {
  const guardada = [{ id: 'a1', texto: 'Aprovar a copy', origem: 'spare-xyz', criadaEm: T0, sessao: 'local_orig' }]
  await setup($, on, { tarefas: guardada }, { conversas: { local_orig: { title: 'Página da live' } } })
  const t = await textos($)
  expect(t.some(x => x.includes('Página da live'))).toBe(true)
  expect(t.some(x => x.includes('spare-xyz'))).toBe(false)
})

test('Ativar manda o pedido pra conversa de origem e abre ela no app', async ($, on) => {
  const guardada = [
    { id: 'a1', texto: 'Aprovar a copy', origem: 'x', criadaEm: T0, sessao: 'local_orig', prompt: 'Escreva a copy da live' },
  ]
  const store: Record<string, unknown> = { tarefas: guardada }
  const { rodados, clock } = await setup($, on, store, { conversas: { local_orig: { title: 'Página da live' } } })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const botao = await ui.find({ type: 'Button', label: 'Ativar' })
  await ui.press({ key: botao.key })
  await ui.unmount()
  await clock.settle()
  expect(store.pedidos).toEqual([{ tarefa: 'a1', sessao: 'local_orig', texto: 'Escreva a copy da live', criadoEm: T0 }])
  expect(rodados).toContainEqual(['open', 'claude://code/continue?session=local_orig'])
  // A tarefa fica no painel até o Feito.
  expect(await textos($)).toContain('Aprovar a copy')
})

test('sem pedido guardado, Ativar usa o texto da tarefa', async ($, on) => {
  const guardada = [{ id: 'a1', texto: 'Ligar pro contador', origem: 'x', criadaEm: T0, sessao: 'local_orig' }]
  const store: Record<string, unknown> = { tarefas: guardada }
  await setup($, on, store, { conversas: { local_orig: { title: 'Contabilidade' } } })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: (await ui.find({ type: 'Button', label: 'Ativar' })).key })
  await ui.unmount()
  const [p] = store.pedidos as Array<{ texto: string }>
  expect(p.texto).toContain('Ligar pro contador')
})

test('a conversa de origem pega o pedido e começa a trabalhar', async ($, on) => {
  const store: Record<string, unknown> = {}
  const { clock, enviados } = await setup($, on, store)
  store.pedidos = [
    { tarefa: 'a1', sessao: ESTA, texto: 'Escreva a copy da live', criadoEm: T0 },
    { tarefa: 'a2', sessao: 'local_outra', texto: 'Outra coisa', criadoEm: T0 },
  ]
  await clock.advance(3_000)
  expect(enviados).toEqual(['Escreva a copy da live'])
  expect(store.pedidos).toEqual([{ tarefa: 'a2', sessao: 'local_outra', texto: 'Outra coisa', criadoEm: T0 }])
  await clock.advance(3_000)
  expect(enviados).toEqual(['Escreva a copy da live'])
})

test('pedido pendente é enviado assim que a conversa de origem abre', async ($, on) => {
  const store: Record<string, unknown> = {
    pedidos: [{ tarefa: 'a1', sessao: ESTA, texto: 'Escreva a copy da live', criadoEm: T0 - MIN }],
  }
  const { enviados } = await setup($, on, store)
  expect(enviados).toEqual(['Escreva a copy da live'])
})

test('pedido velho não é enviado', async ($, on) => {
  const store: Record<string, unknown> = {
    pedidos: [{ tarefa: 'a1', sessao: ESTA, texto: 'Escreva a copy', criadoEm: T0 - 20 * MIN }],
  }
  const { enviados } = await setup($, on, store)
  expect(enviados).toEqual([])
  expect(store.pedidos).toEqual([])
})

test('sem conversa conhecida ou arquivada, não há Ativar, só Feito', async ($, on) => {
  const guardada = [
    { id: 'a1', texto: 'Tarefa antiga', origem: 'pasta', criadaEm: T0 },
    { id: 'a2', texto: 'Tarefa arquivada', origem: 'pasta', criadaEm: T0, sessao: 'local_arq' },
  ]
  await setup($, on, { tarefas: guardada }, { conversas: { local_arq: { title: 'Velha', isArchived: true } } })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const botoes = (await ui.findAll({ type: 'Button' })).map((b: { props: { label: string } }) => b.props.label)
  await ui.unmount()
  expect(botoes).toEqual(['Feito', 'Feito'])
})
