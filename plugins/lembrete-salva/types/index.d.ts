// Como a vez de uma conversa da fila terminou.
export type Resultado = {
  conversa: string
  resposta: string
  // O motivo, quando a resposta é "erro".
  motivo?: string
}

// Uma conversa da fila: o ref que o ListAgents mostra e o nome dela.
export type Vaga = {
  ref: string
  nome: string
}

// A fila do Salvar agora, no $.store, que todas as conversas do app leem e escrevem.
// Cada conversa roda o próprio /salva quando chega a vez dela.
export type FilaSalva = {
  token: string
  coordenador: string
  fila: Vaga[]
  atual: number
  estado: 'preparando' | 'esperando' | 'rodando' | 'finalizando'
  ateAtual: number
  resultados: Resultado[]
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
      // Cópia da fila do $.store, para a faixa desenhar sem ler o store.
      fila: FilaSalva | null
      // Quem esta conversa é no ListAgents, e o token da fila que ela começou.
      meuRef: string
      meuToken: string
      // Quando esta conversa rodou o /salva pela última vez (à mão ou pela fila).
      ultimoSalva: number
    }
  }
}
