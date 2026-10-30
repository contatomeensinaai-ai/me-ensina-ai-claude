import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { FilaSalva, Git, Resultado, Vaga } from '../types'

const MIN = 60_000
const AVISA_DEPOIS = 60 * MIN
const ADIA = 30 * MIN
const ESPERA = 5 * MIN
// Fila sem ninguém mexendo há tanto tempo: quem começou foi fechado.
const ABANDONADA = 15 * MIN
const TIQUE = 5_000
const CHAVE = 'filaSalva'

const git = atom({ plugin: 'lembrete-salva', key: 'git' } as const, { isRepo: false, dirty: 0, ahead: 0, upstreamAt: 0 })
const startedAt = atom({ plugin: 'lembrete-salva', key: 'startedAt' } as const, 0)
const savedAt = atom({ plugin: 'lembrete-salva', key: 'savedAt' } as const, 0)
const snoozeUntil = atom({ plugin: 'lembrete-salva', key: 'snoozeUntil' } as const, 0)
const now = atom({ plugin: 'lembrete-salva', key: 'now' } as const, 0)
const filaVista = atom({ plugin: 'lembrete-salva', key: 'fila' } as const, null)
const meuRef = atom({ plugin: 'lembrete-salva', key: 'meuRef' } as const, '')
const meuToken = atom({ plugin: 'lembrete-salva', key: 'meuToken' } as const, '')
const ultimoSalva = atom({ plugin: 'lembrete-salva', key: 'ultimoSalva' } as const, 0)
// /salva desta conversa há menos que isso: a vez dela na fila passa como "já salvo".
const SALVOU_HA_POUCO = 60 * MIN

type Api = Parameters<Parameters<Parameters<Register>[0]>[1]>[0]

async function runGit($: Api, args: string[]) {
  try {
    return await $.process.run(['git', ...args])
  } catch {
    return undefined
  }
}

// Lê o estado do repositório da sessão: arquivos alterados, commits que não subiram
// e a hora do último commit que já está no GitHub.
async function conferir($: Api): Promise<Git> {
  const repo = await runGit($, ['rev-parse', '--is-inside-work-tree'])
  if (!repo || repo.exitCode !== 0) return { isRepo: false, dirty: 0, ahead: 0, upstreamAt: 0 }

  const status = await runGit($, ['status', '--porcelain'])
  const dirty = status?.exitCode === 0 ? status.stdout.split('\n').filter(l => l.trim()).length : 0

  const log = await runGit($, ['log', '-1', '--format=%ct', '@{u}'])
  const upstreamAt = log?.exitCode === 0 ? Number(log.stdout.trim()) * 1000 || 0 : 0

  const revs = await runGit($, ['rev-list', '--count', '@{u}..HEAD'])
  const ahead = revs?.exitCode === 0 ? Number(revs.stdout.trim()) || 0 : 0

  return { isRepo: true, dirty, ahead, upstreamAt }
}

async function atualizar($: Api) {
  const g = await conferir($)
  await update($, git, () => g)
  const t = await $.clock.now()
  await update($, now, () => t)
  return g
}

function tempo(ms: number) {
  const mins = Math.floor(ms / MIN)
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`
}

function pendente(g: Git) {
  if (g.dirty > 0) return `${g.dirty} ${g.dirty === 1 ? 'arquivo' : 'arquivos'} fora do GitHub`
  return `${g.ahead} ${g.ahead === 1 ? 'commit' : 'commits'} sem enviar pro GitHub`
}

type Conversa = { name?: string; ref?: string; type?: string; status?: string }

// Quem esta conversa é e as outras abertas no app deste computador (fora as da nuvem e as desligadas).
// O ListAgents não lista a própria conversa; o texto dele começa com "This session is <nome> [<ref>]".
async function listar($: Api): Promise<{ eu: string; outras: Vaga[] }> {
  try {
    const r = (await $.tool.call({ tool: 'ListAgents' })) as {
      text?: string
      result?: { listing?: string; text?: string; sections?: { rows?: Conversa[] }[] }
    }
    const texto = `${r.result?.listing ?? ''}\n${r.result?.text ?? ''}\n${r.text ?? ''}`
    const eu = texto.match(/This session is .*\[([0-9a-f]+)\]/)?.[1] ?? ''
    if (eu) await update($, meuRef, () => eu)
    const outras = (r.result?.sections ?? [])
      .flatMap(s => s.rows ?? [])
      .filter(c => c.name && c.ref && c.ref !== eu && /desktop|interactive/i.test(c.type ?? '') && c.status !== 'offline')
      .map(c => ({ ref: String(c.ref), nome: String(c.name) }))
    return { eu, outras }
  } catch {
    return { eu: '', outras: [] }
  }
}

let ultimaBusca = -Infinity

// O ref desta conversa: guardado; se faltar, pergunta ao ListAgents no máximo uma vez por minuto.
async function quemSou($: Api, t: number): Promise<string> {
  const eu = await read($, meuRef)
  if (eu || t - ultimaBusca < MIN) return eu
  ultimaBusca = t
  return (await listar($)).eu
}

// A fila do store; o que a v0.3 guardou (a marca filaAtiva, a rodada no estado) não é lido.
function valida(x: unknown): FilaSalva | null {
  const f = x as FilaSalva | null | undefined
  return f &&
    typeof f.token === 'string' &&
    Array.isArray(f.fila) &&
    Array.isArray(f.resultados) &&
    typeof f.atual === 'number' &&
    typeof f.ateAtual === 'number'
    ? f
    : null
}

async function lerFila($: Api): Promise<FilaSalva | null> {
  try {
    return valida(await $.store.get(CHAVE))
  } catch {
    return null
  }
}

async function guardarVista($: Api, f: FilaSalva | null) {
  const antes = await read($, filaVista)
  if (JSON.stringify(antes) !== JSON.stringify(f)) await update($, filaVista, () => f)
}

// Lê de novo logo antes de escrever e só muda se a guarda ainda vale (o store não tem trava
// entre processos; sobra uma janela pequena). Devolve a fila nova, null se apagou, ou
// undefined se não mudou nada.
async function mudarFila(
  $: Api,
  guarda: (f: FilaSalva) => boolean,
  muda: (f: FilaSalva) => FilaSalva | null,
): Promise<FilaSalva | null | undefined> {
  const f = await lerFila($)
  if (!f || !guarda(f)) return undefined
  const nova = muda(f)
  if (nova) await $.store.set(CHAVE, nova)
  else await $.store.delete(CHAVE)
  await guardarVista($, nova)
  return nova
}

// A vez da conversa atual termina com `resposta` e passa pra próxima.
function avancada(f: FilaSalva, resposta: string, t: number, motivo?: string): FilaSalva {
  const r: Resultado = { conversa: f.fila[f.atual]?.nome ?? '', resposta }
  if (motivo) r.motivo = motivo
  return { ...f, resultados: [...f.resultados, r], atual: f.atual + 1, estado: 'esperando', ateAtual: t + ESPERA }
}

function mesmaVez(f: FilaSalva, token: string, atual: number, estado?: FilaSalva['estado']) {
  return f.token === token && f.atual === atual && f.atual < f.fila.length && (!estado || f.estado === estado)
}

function quantos(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`
}

// As que ficaram de fora vão pelo nome, com a contagem na frente.
const FORA: [string, string, string][] = [
  ['sem resposta', 'sem resposta', 'sem resposta'],
  ['erro', 'erro', 'erros'],
  ['pulada', 'pulada', 'puladas'],
]

function resumo(rs: Resultado[]) {
  const de = (resposta: string) => rs.filter(x => x.resposta === resposta)
  const partes: string[] = []
  const salvas = de('pronto').length
  const ja = de('já salvo').length
  const sem = de('sem salva aqui').length
  if (salvas) partes.push(quantos(salvas, 'salva', 'salvas'))
  if (ja) partes.push(quantos(ja, 'já estava salva', 'já estavam salvas'))
  if (sem) partes.push(`${sem} sem salva aqui`)
  for (const [resposta, um, varios] of FORA) {
    const xs = de(resposta)
    if (xs.length)
      partes.push(`${quantos(xs.length, um, varios)}: ${xs.map(x => x.conversa + (x.motivo ? ` (${x.motivo})` : '')).join(', ')}`)
  }
  return `Salvamento em fila: ${partes.join(' · ')}`
}

// O salva desta conversa, sempre com o argumento que pula o Hub. Fora de ganchos que o turno
// espera: o engine recusa $.command.run lá dentro.
async function rodarSalva($: Api) {
  const agora = await $.clock.now()
  await update($, savedAt, () => agora)
  await $.command.run({ command: 'salva', args: 'lembrete' })
}

async function salvarEsta($: Api) {
  try {
    await rodarSalva($)
  } catch {
    $.ui.toast('Não consegui rodar o /salva nesta conversa. Rode à mão.')
  }
}

async function temSalva($: Api) {
  try {
    return (await $.command.list()).some((c: { name: string }) => c.name === 'salva')
  } catch {
    // Sem a lista, tenta: se o comando não existir, a vez fecha com erro.
    return true
  }
}

function motivoDe(err: unknown) {
  const m = err instanceof Error ? err.message : String(err)
  return m.length > 80 ? `${m.slice(0, 77)}...` : m
}

// O /salva desta conversa rodando por causa da fila: { token, atual } da vez e, quando o turno
// do /salva começa, o turnId dele. Só esse turno fecha a vez.
let minhaVez: { token: string; atual: number; turnId?: string } | undefined

// O /salva chega ao turno já expandido no prompt do comando, com a linha dos argumentos.
// O turno que o comando /salva abre: digitado, expandido pelo app ou vindo da fila.
// Uma mensagem que só cita o /salva no meio do texto não conta.
function eTurnoDoSalva(texto: string) {
  const t = texto.trim()
  return (
    /^\/salva\b/.test(t) ||
    /<command-name>\/salva<\/command-name>/.test(t) ||
    /^#\s*\/salva\b/m.test(t) ||
    /ARGUMENTS:\s*lembrete/.test(t)
  )
}

// Chegou a vez desta conversa: decide aqui mesmo e escreve a resposta na fila.
async function fazerMinhaVez($: Api, f: FilaSalva) {
  const g = await conferir($)
  const t = await $.clock.now()
  const ainda = (c: FilaSalva) => mesmaVez(c, f.token, f.atual, 'esperando')
  if (!g.isRepo || !(await temSalva($))) {
    await mudarFila($, ainda, c => avancada(c, 'sem salva aqui', t))
    return
  }
  // As conversas dividem o repositório: git limpo não quer dizer que esta anotou as lições dela.
  // "Já salvo" só se esta conversa rodou o /salva na última hora.
  const ultimo = await read($, ultimoSalva)
  if (ultimo > 0 && t - ultimo < SALVOU_HA_POUCO) {
    await mudarFila($, ainda, c => avancada(c, 'já salvo', t))
    return
  }
  const rodando = await mudarFila($, ainda, c => ({ ...c, estado: 'rodando', ateAtual: t + ESPERA }))
  if (!rodando) return
  minhaVez = { token: f.token, atual: f.atual }
  // Sem esperar aqui: o relógio segue livre para dar sinal de vida enquanto o /salva roda.
  void (async () => {
    try {
      await rodarSalva($)
    } catch (err) {
      minhaVez = undefined
      const t2 = await $.clock.now()
      await mudarFila($, c => mesmaVez(c, f.token, f.atual, 'rodando'), c => avancada(c, 'erro', t2, motivoDe(err)))
    }
  })()
}

// Fila no fim: só quem marcou "finalizando" salva, resume e apaga.
async function finalizar($: Api, f: FilaSalva) {
  const marcada = await mudarFila(
    $,
    c => c.token === f.token && c.atual >= c.fila.length && c.estado !== 'finalizando' && c.estado !== 'preparando',
    c => ({ ...c, estado: 'finalizando' }),
  )
  if (!marcada) return
  await mudarFila($, c => c.token === f.token, () => null)
  if (marcada.fila.length > 0) $.ui.toast(resumo(marcada.resultados))
  await salvarEsta($)
}

let ocupado = false

// O relógio de cada conversa: lê a fila, faz a vez desta conversa e, na que coordena, cuida do prazo e do fim.
async function tique($: Api) {
  if (ocupado) return
  ocupado = true
  try {
    const t = await $.clock.now()
    const f = await lerFila($)
    await guardarVista($, f)
    if (!f) return

    // Quem começou foi fechado: qualquer conversa apaga.
    if (t > f.ateAtual + ABANDONADA) {
      await mudarFila($, c => c.token === f.token && t > c.ateAtual + ABANDONADA, () => null)
      return
    }
    // Presa em preparando (a lista de conversas não voltou): desfaz sem salvar.
    if (f.estado === 'preparando') {
      if (t > f.ateAtual) await mudarFila($, c => c.token === f.token && c.estado === 'preparando', () => null)
      return
    }

    // Sinal de vida: enquanto o /salva desta conversa roda, o prazo dela não vence.
    const v = minhaVez
    if (v && mesmaVez(f, v.token, v.atual, 'rodando')) {
      await mudarFila($, c => mesmaVez(c, v.token, v.atual, 'rodando'), c => ({ ...c, ateAtual: t + ESPERA }))
      return
    }

    const eu = await quemSou($, t)
    const coordeno = f.token === (await read($, meuToken)) || (!!eu && f.coordenador === eu)
    const vez = f.fila[f.atual]
    if (eu && vez?.ref === eu && f.estado === 'esperando') {
      await fazerMinhaVez($, f)
      return
    }
    if (!coordeno) return
    if (f.atual >= f.fila.length) {
      await finalizar($, f)
      return
    }
    if (t > f.ateAtual) {
      await mudarFila($, c => mesmaVez(c, f.token, f.atual) && t > c.ateAtual, c => avancada(c, 'sem resposta', t))
    }
  } finally {
    ocupado = false
  }
}

let comecando = false

// Salvar agora: esta conversa monta a fila no store e salva por último.
async function comecarFila($: Api) {
  if (comecando) return
  comecando = true
  try {
    const agora = await $.clock.now()
    // Uma fila só: nem duas nesta conversa, nem uma por cima da fila de outra conversa.
    const existente = await lerFila($)
    if (existente && agora <= existente.ateAtual + ABANDONADA) return
    const token = `SALVA-${agora.toString(36)}${Math.random().toString(36).slice(2, 6)}`
    await update($, meuToken, () => token)
    // A marca vai antes de perguntar quem está aberto, para as outras conversas já esconderem o botão.
    const preparando: FilaSalva = {
      token,
      coordenador: await read($, meuRef),
      fila: [],
      atual: 0,
      estado: 'preparando',
      ateAtual: agora + ESPERA,
      resultados: [],
    }
    await $.store.set(CHAVE, preparando)
    await guardarVista($, preparando)
    const { eu, outras } = await listar($)
    const t = await $.clock.now()
    if (!eu || outras.length === 0) {
      // Sem outras conversas (ou sem saber quem esta é): salva só esta.
      await mudarFila($, c => c.token === token, () => null)
      await salvarEsta($)
      return
    }
    const montada = await mudarFila(
      $,
      c => c.token === token && c.estado === 'preparando',
      c => ({ ...c, coordenador: eu, fila: outras, estado: 'esperando', ateAtual: t + ESPERA }),
    )
    if (montada) await tique($)
  } finally {
    comecando = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const t = await $.clock.now()
    if ((await read($, startedAt)) === 0) await update($, startedAt, () => t)
    await atualizar($)
    $.clock.every(MIN, () => atualizar($))
    $.clock.every(TIQUE, () => tique($))
    return next(e)
  })

  // Marca qual turno é o do /salva da fila, para um turno que já rodava não fechar a vez antes.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && eTurnoDoSalva(e.text)) {
      const agora = await $.clock.now()
      await update($, ultimoSalva, () => agora)
    }
    const v = minhaVez
    if (v && !v.turnId && e.agentId === undefined && eTurnoDoSalva(e.text)) {
      const f = await lerFila($)
      if (f && mesmaVez(f, v.token, v.atual, 'rodando')) minhaVez = { ...v, turnId: e.turnId }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await atualizar($)
    // O turno do /salva da fila terminou: a vez desta conversa está feita.
    const v = minhaVez
    if (v && v.turnId && v.turnId === e.turnId) {
      const f = await lerFila($)
      if (!f || f.token !== v.token || f.atual !== v.atual || f.estado !== 'rodando') {
        minhaVez = undefined
      } else {
        minhaVez = undefined
        const t = await $.clock.now()
        const ok = e.reason === 'answer'
        await mudarFila(
          $,
          c => mesmaVez(c, v.token, v.atual, 'rodando'),
          c => (ok ? avancada(c, 'pronto', t) : avancada(c, 'erro', t, 'o /salva foi interrompido')),
        )
      }
    }
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (/\bgit\s+push\b/.test(e.command)) {
      const before = (await read($, git)).upstreamAt
      const g = await atualizar($)
      if (g.upstreamAt > before && g.dirty === 0 && g.ahead === 0) $.ui.toast('Salvo no GitHub')
    }
    return result
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const t = Math.max(await read($, now), await $.clock.now())
    const vista = valida(await read($, filaVista))
    const f = vista && t <= vista.ateAtual + ABANDONADA ? vista : null
    const eu = await read($, meuRef)
    const coordeno = !!f && (f.token === (await read($, meuToken)) || (!!eu && f.coordenador === eu))

    if (f && coordeno) {
      const { Box, Button, Text } = $.ui.resolve(e)
      if (f.estado === 'preparando')
        return (
          <Box gap={1}>
            <Text>Salvando em fila · preparando</Text>
          </Box>
        )
      // Já passou da última: só falta esta conversa salvar. Sem Pular, que passaria a vez de novo.
      if (f.atual >= f.fila.length || f.estado === 'finalizando')
        return (
          <Box gap={1}>
            <Text>Salvando em fila · terminando</Text>
          </Box>
        )
      const { token, atual } = f
      return (
        <Box gap={1}>
          <Text>
            Salvando em fila · {atual + 1} de {f.fila.length} · agora: {f.fila[atual]?.nome ?? ''}
          </Text>
          <Button
            key="pular"
            label="Pular esta conversa"
            onPress={async () => {
              const t2 = await $.clock.now()
              await mudarFila($, c => mesmaVez(c, token, atual), c => avancada(c, 'pulada', t2))
              await tique($)
            }}
          />
        </Box>
      )
    }

    if (f && eu && f.fila[f.atual]?.ref === eu) {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box gap={1}>
          <Text>Salvando esta conversa (fila)</Text>
        </Box>
      )
    }

    const g = await read($, git)
    if (!g.isRepo || (g.dirty === 0 && g.ahead === 0)) return next(e)

    if (t < (await read($, snoozeUntil))) return next(e)

    // Sem GitHub ligado, conta desde o início da sessão.
    const desde = Math.max(await read($, savedAt), g.upstreamAt || (await read($, startedAt)))
    if (t - desde < AVISA_DEPOIS) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    if (f) {
      return (
        <Box gap={1}>
          <Text>Salvamento em fila rodando em outra conversa</Text>
        </Box>
      )
    }

    return (
      <Box gap={1}>
        <Text>Faz {tempo(t - desde)} que você não salva · {pendente(g)}</Text>
        <Button key="salvar" label="Salvar agora" variant="primary" onPress={() => comecarFila($)} />
        <Button
          key="depois"
          label="Depois"
          role="dismiss"
          onPress={async () => {
            const agora = await $.clock.now()
            await update($, snoozeUntil, () => agora + ADIA)
          }}
        />
      </Box>
    )
  })
}
