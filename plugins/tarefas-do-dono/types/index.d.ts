export type Tarefa = {
  id: string
  texto: string
  origem: string
  criadaEm: number
  feitaEm?: number
  // O pedido que a conversa de origem recebe ao clicar em Ativar; sem ele, vale o texto.
  prompt?: string
  // A conversa que anotou: o id local_ do app desktop, ou o da sessão fora dele.
  sessao?: string
}

// Um Ativar à espera de a conversa de origem pegar e enviar.
export type Pedido = {
  tarefa: string
  sessao: string
  texto: string
  criadoEm: number
}

export type Conversa = {
  titulo?: string
  arquivada: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'tarefas-do-dono': { lista: Tarefa[]; agora: number; conversas: Record<string, Conversa> }
  }
}
