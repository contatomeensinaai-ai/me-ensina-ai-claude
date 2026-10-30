import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Conversa, Pedido, Tarefa } from '../types'

const PANE = 'tarefas'
const TITULO = 'Suas tarefas'
const MIN = 60_000
const DIA = 24 * 60 * MIN
const CONFERE = 30_000
const CONFERE_PEDIDOS = 2_000
const PEDIDO_VALE = 15 * MIN

// Cores do tema do Claude: seguem o modo claro e o escuro sozinhas.
const COR_TEXTO = 'claude'
const COR_ATIVAR = 'suggestion'
const COR_FEITO = 'success'

const lista = atom({ plugin: 'tarefas-do-dono', key: 'lista' } as const, [])
const agora = atom({ plugin: 'tarefas-do-dono', key: 'agora' } as const, 0)
const conversas = atom({ plugin: 'tarefas-do-dono', key: 'conversas' } as const, {})

type Api = EngineInterface

async function carregar($: Api): Promise<Tarefa[]> {
  const v = await $.store.get('tarefas')
  return Array.isArray(v) ? (v as Tarefa[]) : []
}

async function carregarPedidos($: Api): Promise<Pedido[]> {
  const v = await $.store.get('pedidos')
  return Array.isArray(v) ? (v as Pedido[]) : []
}

// A conversa em que este processo roda: o id local_ do app desktop, ou o da sessão fora dele.
async function estaSessao($: Api): Promise<string> {
  return (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')) ?? (await $.session.id())
}

// O app desktop guarda cada conversa num arquivo com o título e se foi arquivada.
async function lerConversa($: Api, sessao: string): Promise<Conversa | undefined> {
  if (!sessao.startsWith('local_')) return undefined
  const home = await $.env.get('HOME')
  const conta = await $.env.get('CLAUDE_CODE_ACCOUNT_UUID')
  const org = await $.env.get('CLAUDE_CODE_ORGANIZATION_UUID')
  if (!home || !conta || !org) return undefined
  try {
    const bruto = await $.fs.read(`${home}/Library/Application Support/Claude/claude-code-sessions/${conta}/${org}/${sessao}.json`)
    const c = JSON.parse(String(bruto)) as { title?: unknown; isArchived?: unknown }
    return { titulo: typeof c.title === 'string' && c.title.trim() ? c.title : undefined, arquivada: c.isArchived === true }
  } catch {
    return undefined
  }
}

// Relê os títulos das conversas de origem (o app pode renomear ou arquivar).
async function atualizarConversas($: Api, l: Tarefa[]) {
  const ids = [...new Set(l.filter(x => !x.feitaEm && x.sessao).map(x => x.sessao as string))]
  const achadas: Record<string, Conversa> = {}
  for (const id of ids) {
    const c = await lerConversa($, id)
    if (c) achadas[id] = c
  }
  await update($, conversas, () => achadas)
}

// Relê a lista guardada (outras conversas podem ter mudado) e o relógio.
async function sincronizar($: Api) {
  const l = await carregar($)
  await update($, lista, () => l)
  const t = await $.clock.now()
  await update($, agora, () => t)
  await atualizarConversas($, l)
  return l
}

// Muda a lista a partir do que está guardado agora, não do que esta conversa leu antes.
async function mudar($: Api, fn: (l: Tarefa[], t: number) => Tarefa[]) {
  const t = await $.clock.now()
  const nova = fn(await carregar($), t).filter(x => !x.feitaEm || t - x.feitaEm < 7 * DIA)
  await $.store.set('tarefas', nova)
  await update($, lista, () => nova)
  await update($, agora, () => t)
}

async function anotar($: Api, texto: string, extra: { prompt?: string } = {}) {
  const limpo = texto.trim()
  if (!limpo) return
  const origem = (await $.session.cwd()).split(/[\\/]/).filter(Boolean).pop() ?? 'esta conversa'
  const sessao = await estaSessao($)
  const prompt = extra.prompt?.trim() || undefined
  await mudar($, (l, t) => [...l, { id: `${t}-${l.length}`, texto: limpo, origem, criadaEm: t, sessao, ...(prompt ? { prompt } : {}) }])
  await atualizarConversas($, await read($, lista))
}

function pedidoDe(x: Tarefa) {
  return (
    x.prompt ??
    `Tarefa do painel Suas tarefas: "${x.texto}". Trabalhe nela agora: faça o que você consegue e me pergunte só o que depende de mim.`
  )
}

// Ativar: deixa o pedido pra conversa de origem pegar e traz essa conversa pra tela.
async function ativar($: Api, x: Tarefa) {
  if (!x.sessao) return
  const sessao = x.sessao
  const t = await $.clock.now()
  const pedidos = (await carregarPedidos($)).filter(p => p.tarefa !== x.id)
  await $.store.set('pedidos', [...pedidos, { tarefa: x.id, sessao, texto: pedidoDe(x), criadoEm: t }])
  if (sessao.startsWith('local_')) await $.process.run(['open', `claude://code/continue?session=${sessao}`])
}

// Na conversa de origem: envia o que foi ativado pra ela e descarta pedido velho.
async function pegarPedidos($: Api, sessao: string) {
  const pedidos = await carregarPedidos($)
  if (pedidos.length === 0) return
  const t = await $.clock.now()
  const meus = pedidos.filter(p => p.sessao === sessao)
  const restantes = pedidos.filter(p => p.sessao !== sessao && t - p.criadoEm < PEDIDO_VALE)
  if (restantes.length === pedidos.length) return
  await $.store.set('pedidos', restantes)
  for (const p of meus) {
    if (t - p.criadoEm >= PEDIDO_VALE) continue
    void $.prompt.submit({ text: p.texto })
  }
}

function ha(ms: number) {
  if (ms < 5 * MIN) return 'agora'
  if (ms < 60 * MIN) return `há ${Math.floor(ms / MIN)} min`
  if (ms < DIA) return `há ${Math.floor(ms / (60 * MIN))} h`
  if (ms < 2 * DIA) return 'ontem'
  return `há ${Math.floor(ms / DIA)} dias`
}

function mesmoDia(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tarefas', description: 'Abre o painel Suas tarefas' })
    await $.tool.register({
      name: 'anotar_tarefa',
      description:
        'Anota no painel "Suas tarefas" algo que só o dono pode fazer: login, senha, aprovação, assinatura, documento, ligação, pagamento ou decisão. ' +
        'Use sempre que o trabalho depender do dono. Não anote o que você mesmo consegue fazer. ' +
        'O texto é uma frase curta que começa com verbo, como "Aprovar o orçamento da cozinha". ' +
        'Mande também o prompt: o pedido que esta conversa recebe quando o dono clicar em Ativar na tarefa, ' +
        'escrito como o dono pediria, com o contexto que você precisaria pra continuar daqui.',
      inputSchema: {
        type: 'object',
        properties: {
          texto: { type: 'string', description: 'A tarefa, em uma frase que começa com verbo' },
          prompt: {
            type: 'string',
            description: 'O pedido enviado a esta conversa quando o dono clicar em Ativar. Sem ele, vale o texto da tarefa.',
          },
        },
        required: ['texto'],
      },
      isDeferred: false,
    })

    const sessao = await estaSessao($)
    await pegarPedidos($, sessao)
    const pendentes = (await sincronizar($)).filter(x => !x.feitaEm)
    if (pendentes.length > 0) {
      $.ui.toast(`${pendentes.length} ${pendentes.length === 1 ? 'tarefa esperando' : 'tarefas esperando'} você`)
      void $.ui.open({ id: PANE, title: TITULO })
    }
    $.clock.every(CONFERE, () => sincronizar($))
    $.clock.every(CONFERE_PEDIDOS, () => pegarPedidos($, sessao))
    return next(e)
  })

  on('command.run', { command: 'tarefas' }, async $ => {
    await sincronizar($)
    await $.ui.open({ id: PANE, title: TITULO })
    return { text: 'Painel Suas tarefas aberto.' }
  })

  on('tool.call', { tool: 'mcp__tarefas-do-dono__anotar_tarefa' }, async ($, e) => {
    const entrada = e as { texto?: unknown; prompt?: unknown }
    const texto = String(entrada.texto ?? '').trim()
    if (!texto) return { result: 'Nada anotado: o texto da tarefa veio vazio.' }
    await anotar($, texto, { prompt: typeof entrada.prompt === 'string' ? entrada.prompt : undefined })
    $.ui.toast(`Tarefa nova pra você: ${texto}`)
    return { result: `Tarefa anotada no painel Suas tarefas: ${texto}` }
  }).catch(() => ({ result: 'Não consegui anotar a tarefa agora. Diga a tarefa ao dono na resposta.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // O app do celular ainda não desenha campo de texto.
    const Input = 'Input' in ui ? ui.Input : undefined
    const l = await read($, lista)
    const c = await read($, conversas)
    const t = Math.max(await read($, agora), await $.clock.now())
    const pendentes = l.filter(x => !x.feitaEm)
    const feitasHoje = l.filter(x => x.feitaEm && mesmoDia(x.feitaEm, t)).length

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Aqui ficam as coisas que os agentes não conseguem fazer sem você.</Text>
        {pendentes.length === 0 && <Text dimColor>Nada esperando você.</Text>}
        {pendentes.map(x => {
          const conversa = x.sessao ? c[x.sessao] : undefined
          const podeAtivar = conversa !== undefined && !conversa.arquivada
          return (
            <Box key={`linha-${x.id}`} flexDirection="column">
              <Text color={COR_TEXTO} weight="semibold">
                {x.texto}
              </Text>
              <Text dimColor>
                {conversa?.titulo ?? x.origem} · {ha(t - x.criadaEm)}
              </Text>
              <Box gap={1}>
                {podeAtivar && (
                  <Button key={`ativar-${x.id}`} label="Ativar" variant="primary" onPress={() => ativar($, x)}>
                    <Text color={COR_ATIVAR} weight="bold">
                      ▶ Ativar
                    </Text>
                  </Button>
                )}
                <Button
                  key={`feito-${x.id}`}
                  label="Feito"
                  onPress={() => mudar($, (atual, quando) => atual.map(y => (y.id === x.id ? { ...y, feitaEm: quando } : y)))}
                >
                  <Text color={COR_FEITO} weight="bold">
                    ✓ Feito
                  </Text>
                </Button>
              </Box>
            </Box>
          )
        })}
        {feitasHoje > 0 && <Text dimColor>{feitasHoje} {feitasHoje === 1 ? 'feita hoje' : 'feitas hoje'}</Text>}
        {Input && (
          <Input
            key="nova"
            placeholder="Escreva algo que só você pode fazer"
            submitLabel="Adicionar"
            onSubmit={(valor: string) => anotar($, valor)}
          />
        )}
      </Box>
    )
  })
}
