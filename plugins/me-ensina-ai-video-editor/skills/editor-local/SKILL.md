---
name: editor-local
description: Prepare, abra e opere o editor local Me Ensina AI quando o usuário pedir para abrir o editor ou editar vídeos, legendas e imagens com este plugin.
---
# Me Ensina AI — Editor de Vídeo

Editor local para Claude Code. Roda em macOS Apple Silicon, macOS Intel e Windows x64. O aluno não precisa instalar nada no Terminal nem procurar binário. Este plugin oferece skill e inicializador; não declara MCP de edição da timeline.

## Ambiente de execução

Confirme o sistema do host: macOS arm64/x64 ou Windows x64. Linux, Windows ARM, WSL e containers não são suportados. Não instale runtime de outro sistema.

## Abertura — regra obrigatória

**O editor abre SEMPRE dentro do painel de navegador do Claude, nunca no navegador do sistema.** O aluno conversa com você e vê o editor ao lado, na mesma janela. Abrir fora quebra o fluxo: você perde o controle da página e não consegue mais editar conversando.

Isso significa, sem exceção:

1. Execute o launcher **sempre com a flag que impede a abertura externa**: `--no-open` no Mac, `-NoOpen` no Windows. Nunca rode sem a flag.
2. Abra a URL retornada com a ferramenta de navegador do Claude (`preview_start` com a `url`, ou `navigate`).
3. Se o painel já tiver uma aba nessa origem, **reutilize**. Não recarregue nem feche aba durante uma edição.
4. Nunca chame `open`, `start`, `rundll32` ou equivalente para jogar no navegador do sistema.

Se a ferramenta de navegador não existir no ambiente, **diga a limitação e pare**. Não caia no navegador externo como alternativa silenciosa.

Depois de abrir, o painel pode estar recolhido na janela do usuário. Se ele disser que não está vendo, confirme por `tabs_context`: quando a resposta indicar que o painel está oculto, peça para ele abrir o painel de navegador na janela do Claude, em vez de reabrir a página.

## Preparação

1. A partir deste SKILL.md, resolva `../../launcher/open-editor.command` no Mac ou `../../launcher/open-editor.ps1` no Windows dentro da mesma raiz do plugin. Leia o script e seus auxiliares antes da primeira execução.
2. Avise que a primeira preparação baixa bibliotecas públicas e pode levar alguns minutos; nenhum modelo de IA é baixado nessa etapa.
   - Mac: `/bin/bash "<caminho absoluto>/open-editor.command" --no-open`
   - Windows: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<caminho absoluto>\open-editor.ps1" -NoOpen`
   O parâmetro `-ExecutionPolicy Bypass` vale **apenas para esse processo** e não altera a política da máquina. Ele é necessário porque a política padrão do Windows para usuário final bloqueia scripts, e o aluno não deve precisar mexer em configuração de segurança do sistema. Nunca rode `Set-ExecutionPolicy`, que muda a máquina inteira.
3. O launcher valida plataforma, pacote e dependências; reutiliza o editor aberto ou prepara uma versão isolada. **Não substitua nem encerre outro serviço na porta.** Fechar a janela do navegador não encerra o servidor: se precisar trocar de versão, confirme com o usuário antes de encerrar o processo.
4. Confirme `/api/health` na URL retornada e a abertura no painel. Abrir a página comprova abertura, não todas as funções.
5. Se a preparação falhar, relate o passo concreto que quebrou, com sistema, arquitetura e a mensagem real. Não peça ao usuário para procurar binários ou repetir login sem diagnóstico.

## Edição

Inspecione a timeline antes de mudar. Exporte `.timeline` antes de substituir projetos. Use somente ferramentas de navegador documentadas e controles visíveis. Sem ferramenta de operação disponível, abra o editor e diga a limitação; não invente uma edição.

O campo **Texto da legenda** fica num painel com rolagem e pode nascer fora da área visível. Se o usuário disser que não consegue editar legenda, role o campo até a vista antes de concluir que o recurso não existe.

Use a transcrição para cortes e imagens de apoio. Preserve IDs, sincronização e fala. Revise tempos, aplique na prévia e confira o vídeo final. Legendas locais requerem download de modelo autorizado.

Antes de concluir exportação, confirme arquivo, áudio, duração e imagem. Recursos experimentais e qualidade de IA não são garantidos. Não publique conteúdo sem pedido explícito. Nunca envie dados pessoais em issues públicas.

## Recursos que dependem de CLI externa

Os botões de IA do editor (sugerir palavras, imagens de apoio, restauração) chamam uma CLI externa instalada na máquina do usuário e usam a conta dele. Sem essa CLI, `codexAvailable` volta `false` e esses botões ficam indisponíveis. **Todo o resto do editor funciona normalmente**: importar, cortar, legendar, estilizar, exportar.

Quando faltar, diga isso de forma direta e siga com a edição manual. Não instale conta, não copie autenticação, não prometa que um botão vai funcionar.

## Dados

Ficam em `~/Library/Application Support/Me Ensina AI` no Mac ou `%LOCALAPPDATA%\Me Ensina AI` no Windows. O projeto do usuário é salvo no armazenamento do navegador, atrelado à origem `127.0.0.1:5201`. Preserve essa pasta e essa origem. No Windows use disco local NTFS; caminhos de rede/UNC não são suportados.
