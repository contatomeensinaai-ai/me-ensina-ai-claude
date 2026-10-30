# Tarefas do dono

Mod do Claude Code (Me Ensina AI). Abre um painel "Suas tarefas" ao lado do chat com tudo o que só você pode fazer: login, senha, aprovação, assinatura, documento, ligação, pagamento ou decisão.

- O Claude anota sozinho quando o trabalho depende de você. Você também pode escrever uma tarefa no campo do painel ("Escreva algo que só você pode fazer").
- A lista é a mesma em todas as conversas do computador. O que uma conversa anotou aparece nas outras.
- Cada tarefa mostra o título da conversa que a anotou e há quanto tempo, com dois botões:
  - **Ativar** manda o pedido da tarefa para a conversa que a anotou, abre essa conversa no app e ela começa a trabalhar. A tarefa continua no painel.
  - **Feito** tira a tarefa da lista.
- O Claude anota a tarefa já com o pedido pronto (`prompt`). Sem ele, o Ativar manda o próprio texto da tarefa.
- O Ativar só aparece quando a conversa de origem existe no app e não foi arquivada. Um pedido que a conversa não pegar em 15 minutos é descartado.
- O comando `/tarefas` abre o painel. Ao abrir uma conversa com pendência, um aviso mostra quantas tarefas esperam você.

Tudo fica no seu computador: o mod não acessa a internet, não lê conector e não gasta uso extra do plano. Para mostrar o título e abrir a conversa ele lê os arquivos de conversa do app Claude e usa o link `claude://code/continue`, recursos internos do app que podem mudar numa atualização. Só existe no Claude Code.

## Como instalar

No app Claude, na aba Code: clique no + ao lado da caixa de digitar, depois em Plugins, Add marketplace com `contatomeensinaai-ai/me-ensina-ai-claude`, e em Add plugin escolha `tarefas-do-dono`.

No terminal, dentro do Claude Code:

```
/plugin install tarefas-do-dono --marketplace contatomeensinaai-ai/me-ensina-ai-claude
```

Responda `y` para adicionar o marketplace e escolha o escopo de usuário. Depois abra uma conversa nova: as conversas que já estavam abertas não carregam o mod.

No Windows, o painel e o botão Feito funcionam. O botão Ativar, por enquanto, só aparece no Mac.
