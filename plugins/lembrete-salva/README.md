# Lembrete do /salva

Mod do Claude Code (Me Ensina AI). Mostra uma faixa acima do campo de digitar quando faz 1 hora ou mais que o seu trabalho não vai pro GitHub e existe arquivo alterado ou commit sem enviar.

- **Salvar agora** monta uma fila com as conversas abertas no app e salva uma de cada vez. Nenhuma conversa manda mensagem para outra: a fila fica guardada no próprio mod, que todas as conversas leem, e o mod de cada conversa roda o `/salva` dela quando chega a vez. Conversa que já rodou o `/salva` na última hora passa a vez sem rodar de novo; conversa sem `/salva` ou sem GitHub também passa. Enquanto o `/salva` de uma conversa roda, ela avisa que está viva e a fila espera o tempo que for; conversa que some (fechada ou travada) por 5 minutos fica para o próximo salvamento. A faixa de quem clicou mostra "Salvando em fila · 2 de 5 · agora: <conversa>" e o botão **Pular esta conversa**; a conversa da vez mostra "Salvando esta conversa (fila)". No fim, quem clicou roda o `/salva` dela e um aviso resume quantas salvaram e quais ficaram de fora. Enquanto a fila roda, as outras conversas não oferecem um segundo Salvar agora.
- **Depois** esconde a faixa por 30 minutos.
- Quando um `git push` dá certo, aparece o aviso "Salvo no GitHub".

O que conta como salvo é o último commit que já está no GitHub, venha ele do `/salva`, do backup automático ou de um envio à mão. Sem GitHub ligado, o tempo conta desde o início da conversa.

O mod só roda `git` na pasta da conversa. Não acessa a internet, não lê conector e não envia nada sem o seu clique. Precisa de um comando `/salva` no projeto (o kit do BA já tem). O mod roda `/salva lembrete`: se o seu `/salva` tem um passo de registro no Hub, esse argumento pula o passo para a fila não travar. Só existe no Claude Code (no Codex, use o `$salva`).

## Como instalar

No app Claude, na aba Code: clique no + ao lado da caixa de digitar, depois em Plugins, Add marketplace com `contatomeensinaai-ai/me-ensina-ai-claude` (se já adicionou para o Tarefas do dono, pule esta parte), e em Add plugin escolha `lembrete-salva`.

No terminal, dentro do Claude Code:

```
/plugin install lembrete-salva --marketplace contatomeensinaai-ai/me-ensina-ai-claude
```

Responda `y` para adicionar o marketplace e escolha o escopo de usuário. Depois abra uma conversa nova: as conversas que já estavam abertas não carregam o mod. Instalado uma vez, o mod roda em todas as conversas, e a fila precisa disso: reabra as conversas que estavam abertas depois de instalar ou atualizar, senão elas ficam sem resposta na fila.
