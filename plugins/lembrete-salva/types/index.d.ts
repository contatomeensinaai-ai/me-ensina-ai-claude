// Como uma conversa da fila respondeu (ou o que aconteceu com ela).
export type Resultado = {
  conversa: string
  resposta: string
  // O motivo que a conversa deu junto com "erro".
  motivo?: string
}

// A fila do Salvar agora, guardada na conversa que clicou.
export type Rodada = {
  token: string
  fila: string[]
  atual: number
  resultados: Resultado[]
  ateAtual: number
}

// Marca no $.store, vista por todas as conversas, enquanto uma fila roda.
export type FilaAtiva = {
  token: string
  ate: number
}

export type Git = {
  isRepo: boolean
  dirty: number
  ahead: number
  upstreamAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'lembrete-salva': {
      git: Git
      startedAt: number
      savedAt: number
      snoozeUntil: number
      now: number
      rodada: Rodada | null
      outraFila: number
    }
  }
}
