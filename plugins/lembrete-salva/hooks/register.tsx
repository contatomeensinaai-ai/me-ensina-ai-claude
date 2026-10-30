import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { FilaAtiva, Git, Resultado, Rodada } from '../types'

const MIN = 60_000
const AVISA_DEPOIS = 60 * MIN
const ADIA = 30 * MIN
const ESPERA = 5 * MIN

const git = atom({ plugin: 'lembrete-salva', key: 'git' } as const, { isRepo: false, dirty: 0, ahead: 0, upstreamAt: 0 })
const startedAt = atom({ plugin: 'lembrete-salva', key: 'startedAt' } as const, 0)
const savedAt = atom({ plugin: 'lembrete-salva', key: 'savedAt' } as const, 0)
const snoozeUntil = atom({ plugin: 'lembrete-salva', key: 'snoozeUntil' } as const, 0)
const now = atom({ plugin: 'lembrete-salva', key: 'now' } as const, 0)
const rodada = atom({ plugin: 'lembrete-salva', key: 'rodada' } as const, null)
const outraFila = atom({ plugin: 'lembrete-salva', key: 'outraFila' } as const, 0)

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
  // Fila de outra conversa: a marca fica no $.store, que todas as conversas leem.
  const f = (await $.store.get('filaAtiva')) as FilaAtiva | null | undefined
  await update($, outraFila, () => (f && typeof f.ate === 'number' ? f.ate : 0))
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

// As outras conversas abertas no app deste computador (fora as da nuvem e as desligadas).
async function conversasAbertas($: Api): Promise<string[]> {
  try {
    const r = await $.tool.call({ tool: 'ListAgents' })
    const secoes = ((r as { result?: { sections?: { rows?: Conversa[] }[] } }).result?.sections ?? [])
    return secoes
      .flatMap(s => s.rows ?? [])
      .filter(c => c.name && /desktop|interactive/i.test(c.type ?? '') && c.status !== 'offline')
      .map(c => (c.ref ? `${c.name} [${c.ref}]` : String(c.name)))
  } catch {
    return []
  }
}

// A rodada que a v1 guardou não tem fila: não serve.
function valida(x: unknown): Rodada | null {
  const r = x as Rodada | null | undefined
  return r && Array.isArray(r.fila) && Array.isArray(r.resultados) ? r : null
}

async function lerRodada($: Api): Promise<Rodada | null> {
  return valida(await read($, rodada))
}

function nome(conversa: string) {
  return conversa.replace(/ \[[^\]]*\]$/, '')
}

// Um código por posição da fila: resposta atrasada de uma conversa pulada não vale pra da vez.
function codigo(r: Rodada) {
  return `${r.token}-${r.atual}`
}

// Para onde as outras conversas respondem: o id local_ do app desktop, ou o da sessão fora dele.
async function endereco($: Api): Promise<string> {
  try {
    return (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')) || (await $.session.id())
  } catch {
    return ''
  }
}

function pedido(cod: string, para: string) {
  return (
    `${cod} Pedido automático do lembrete do salva: as conversas abertas estão salvando uma de cada vez e agora é a sua vez. ` +
    `Responda com a ferramenta SendMessage para a conversa que te mandou este pedido (o remetente desta mensagem; o endereço dela é "${para}"). ` +
    `Se você rodou o /salva nesta conversa na última hora e nada mudou desde então, não rode e responda só "${cod}: já salvo". ` +
    `Se a pasta desta conversa não tem o comando salva ou não tem GitHub, responda só "${cod}: sem salva aqui". ` +
    `Senão, rode /salva lembrete (o argumento lembrete pula o passo do Hub) e, quando terminar, responda só "${cod}: pronto", ` +
    `ou "${cod}: erro" e o motivo em poucas palavras se o envio pro GitHub falhou. ` +
    `Se antes de começar chegar "${cod} cancelado", não rode o /salva.`
  )
}

function cancelamento(cod: string) {
  return `${cod} cancelado: não rode o /salva agora; o que você tem fica para o próximo salvamento.`
}

// Resposta de uma conversa da fila: começa pelo código e dois pontos.
const RESPOSTA = /^\s*SALVA-[a-z0-9]+-\d+:/

function classificar(texto: string): { resposta: string; motivo?: string } {
  const corpo = texto.replace(/^[\s\S]*?SALVA-[a-z0-9]+-\d+:\s*/, '').trim()
  if (/^já salvo\b/i.test(corpo)) return { resposta: 'já salvo' }
  if (/^sem salva\b/i.test(corpo)) return { resposta: 'sem salva aqui' }
  if (/^erro\b/i.test(corpo)) {
    const motivo = corpo.replace(/^erro[\s:,.;-]*/i, '').trim()
    return motivo ? { resposta: 'erro', motivo } : { resposta: 'erro' }
  }
  if (/^pronto\b/i.test(corpo)) return { resposta: 'pronto' }
  return { resposta: 'resposta estranha' }
}

function quantos(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`
}

// As que ficaram de fora vão pelo nome, com a contagem na frente.
const FORA: [string, string, string][] = [
  ['sem resposta', 'sem resposta', 'sem resposta'],
  ['erro', 'erro', 'erros'],
  ['pulada', 'pulada', 'puladas'],
  ['não entregue', 'não entregue', 'não entregues'],
  ['resposta estranha', 'resposta estranha', 'respostas estranhas'],
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
      partes.push(
        `${quantos(xs.length, um, varios)}: ${xs.map(x => nome(x.conversa) + (x.motivo ? ` (${x.motivo})` : '')).join(', ')}`,
      )
  }
  return `Salvamento em fila: ${partes.join(' · ')}`
}

let fim: { cancel: () => void } | undefined

// O salva desta conversa, sempre com o argumento que pula o Hub.
async function salvarEsta($: Api) {
  const agora = await $.clock.now()
  await update($, savedAt, () => agora)
  try {
    await $.command.run({ command: 'salva', args: 'lembrete' })
  } catch {
    $.ui.toast('Não consegui rodar o /salva nesta conversa. Rode à mão.')
  }
}

// Só quem levou a fila até o fim chama: roda uma vez por fila.
async function finalizar($: Api, r: Rodada | null) {
  fim?.cancel()
  fim = undefined
  if (r) {
    await update($, rodada, cur => (valida(cur)?.token === r.token ? null : cur))
    const f = (await $.store.get('filaAtiva')) as FilaAtiva | null | undefined
    if (f && f.token === r.token) await $.store.set('filaAtiva', null)
    if (r.fila.length > 0) $.ui.toast(resumo(r.resultados))
  }
  await salvarEsta($)
}

// Passa a vez adiante, só se a vez ainda é `cod`. Devolve a rodada nova, ou nada se outro já passou.
async function passarVez($: Api, cod: string, resultado: Omit<Resultado, 'conversa'>): Promise<Rodada | null> {
  const feito: { r: Rodada | null } = { r: null }
  await update($, rodada, cur => {
    feito.r = null
    const c = valida(cur)
    if (!c || c.atual >= c.fila.length || codigo(c) !== cod) return cur
    // ateAtual zerado: o relógio de 1 minuto não conta prazo antes do pedido seguinte chegar.
    feito.r = {
      ...c,
      resultados: [...c.resultados, { conversa: c.fila[c.atual] ?? '', ...resultado }],
      atual: c.atual + 1,
      ateAtual: 0,
    }
    return feito.r
  })
  return feito.r
}

// Manda o pedido pra conversa da vez; pedido que não chega pula pra próxima.
async function avancar($: Api, inicio: Rodada) {
  const para = await endereco($)
  let r = inicio
  while (r.atual < r.fila.length) {
    const to = r.fila[r.atual] ?? ''
    const cod = codigo(r)
    let entregue = false
    try {
      entregue = (await $.session.send({ to, text: pedido(cod, para) })).isDelivered
    } catch {}
    if (entregue) {
      const t = await $.clock.now()
      const vez = r
      const marcou = { ok: false }
      await update($, rodada, cur => {
        marcou.ok = false
        const c = valida(cur)
        if (!c || c.token !== vez.token || c.atual !== vez.atual) return cur
        marcou.ok = true
        return { ...c, ateAtual: t + ESPERA }
      })
      if (!marcou.ok) return
      await $.store.set('filaAtiva', { token: r.token, ate: t + ESPERA })
      fim?.cancel()
      fim = $.clock.after(ESPERA, () => resolver($, cod, { resposta: 'sem resposta' }))
      return
    }
    const seguinte = await passarVez($, cod, { resposta: 'não entregue' })
    if (!seguinte) return
    r = seguinte
  }
  await finalizar($, r)
}

// Fecha a vez da conversa atual com a resposta dela e passa pra próxima.
async function resolver($: Api, cod: string, resultado: Omit<Resultado, 'conversa'>) {
  const seguinte = await passarVez($, cod, resultado)
  if (!seguinte) return
  fim?.cancel()
  fim = undefined
  // Pulada ou sem resposta: o pedido já está na fila dela; avisa pra não rodar junto com a próxima.
  const to = seguinte.fila[seguinte.atual - 1]
  if (to && (resultado.resposta === 'pulada' || resultado.resposta === 'sem resposta')) {
    try {
      await $.session.send({ to, text: cancelamento(cod) })
    } catch {}
  }
  await avancar($, seguinte)
}

// Rede de segurança do prazo: se o timer se perdeu (o mod recarregou), o relógio de 1 minuto pula.
async function conferirFila($: Api) {
  const r = await lerRodada($)
  if (!r || r.ateAtual <= 0 || (await $.clock.now()) <= r.ateAtual) return
  if (r.fila.length > 0) return resolver($, codigo(r), { resposta: 'sem resposta' })
  // Presa em preparando (a lista de conversas não voltou): desfaz sem salvar.
  const desfeita = { ok: false }
  await update($, rodada, cur => {
    const c = valida(cur)
    desfeita.ok = !!c && c.token === r.token && c.fila.length === 0
    return desfeita.ok ? null : cur
  })
  if (!desfeita.ok) return
  const f = (await $.store.get('filaAtiva')) as FilaAtiva | null | undefined
  if (f && f.token === r.token) await $.store.set('filaAtiva', null)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const t = await $.clock.now()
    if ((await read($, startedAt)) === 0) await update($, startedAt, () => t)
    await atualizar($)
    $.clock.every(MIN, async () => {
      await atualizar($)
      await conferirFila($)
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await atualizar($)
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

  on('session.receive', async ($, e, next) => {
    const r = await lerRodada($)
    if (!r || !e.text.includes(r.token)) {
      // Resposta atrasada de uma fila que já acabou: não vai pro Claude.
      if (RESPOSTA.test(e.text)) return { consumed: 'resposta atrasada ao pedido do lembrete do salva' }
      return next(e)
    }
    const m = e.text.match(new RegExp(`${r.token}-(\\d+)`))
    // Fora do gancho: o $.command.run do fim da fila é recusado dentro de um gancho que o turno espera.
    if (m && Number(m[1]) === r.atual) {
      const cod = codigo(r)
      const resposta = classificar(e.text)
      $.clock.after(0, () => resolver($, cod, resposta))
    }
    return { consumed: 'resposta ao pedido do lembrete do salva' }
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const r = await lerRodada($)
    if (r && r.fila.length === 0) {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box gap={1}>
          <Text>Salvando em fila · preparando</Text>
        </Box>
      )
    }
    // Já passou da última: só falta esta conversa salvar. Sem Pular, que passaria a vez de novo.
    if (r && r.atual >= r.fila.length) {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box gap={1}>
          <Text>Salvando em fila · terminando</Text>
        </Box>
      )
    }
    if (r) {
      const { Box, Button, Text } = $.ui.resolve(e)
      return (
        <Box gap={1}>
          <Text>
            Salvando em fila · {Math.min(r.atual + 1, r.fila.length)} de {r.fila.length} · agora: {nome(r.fila[r.atual] ?? '')}
          </Text>
          <Button key="pular" label="Pular esta conversa" onPress={() => resolver($, codigo(r), { resposta: 'pulada' })} />
        </Box>
      )
    }

    const g = await read($, git)
    if (!g.isRepo || (g.dirty === 0 && g.ahead === 0)) return next(e)

    const t = Math.max(await read($, now), await $.clock.now())
    if (t < (await read($, snoozeUntil))) return next(e)

    // Sem GitHub ligado, conta desde o início da sessão.
    const desde = Math.max(await read($, savedAt), g.upstreamAt || (await read($, startedAt)))
    if (t - desde < AVISA_DEPOIS) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    if ((await read($, outraFila)) > t) {
      return (
        <Box gap={1}>
          <Text>Salvamento em fila rodando em outra conversa</Text>
        </Box>
      )
    }

    return (
      <Box gap={1}>
        <Text>Faz {tempo(t - desde)} que você não salva · {pendente(g)}</Text>
        <Button
          key="salvar"
          label="Salvar agora"
          variant="primary"
          onPress={async () => {
            // Uma fila só: nem duas nesta conversa, nem uma por cima da fila de outra conversa.
            if (await lerRodada($)) return
            const agora = await $.clock.now()
            const f = (await $.store.get('filaAtiva')) as FilaAtiva | null | undefined
            if (f && typeof f.ate === 'number' && f.ate > agora) return
            const token = `SALVA-${agora.toString(36)}`
            const comecou = { ok: false }
            await update($, rodada, cur => {
              comecou.ok = false
              if (valida(cur)) return cur
              comecou.ok = true
              // Com prazo: se a lista de conversas nunca voltar, o relógio desfaz esta fila.
              return { token, fila: [], atual: 0, resultados: [], ateAtual: agora + ESPERA }
            })
            if (!comecou.ok) return
            // A marca vai antes de perguntar quem está aberto, para as outras conversas já esconderem o botão.
            await $.store.set('filaAtiva', { token, ate: agora + ESPERA })
            const outras = await conversasAbertas($)
            const pronta: { r: Rodada | null } = { r: null }
            await update($, rodada, cur => {
              pronta.r = null
              const c = valida(cur)
              if (!c || c.token !== token || c.fila.length > 0) return cur
              pronta.r = { ...c, fila: outras, ateAtual: 0 }
              return pronta.r
            })
            if (!pronta.r) return
            if (outras.length === 0) return finalizar($, pronta.r)
            await avancar($, pronta.r)
          }}
        />
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
