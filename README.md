# Me Ensina AI — Editor de Vídeo · Claude Code

**Marketplace exclusivo para Claude Code. Plugin versão 2.1.1.** Mac Apple Silicon, Mac Intel e Windows x64.

O editor abre **dentro da conversa**, no painel ao lado. Você conversa e o editor responde na mesma janela.

## Instalar

No Claude Code, dois comandos:

```bash
claude plugin marketplace add contatomeensinaai-ai/me-ensina-ai-claude
claude plugin install me-ensina-ai-video-editor@me-ensina-ai-claude
```

Dentro de uma sessão interativa, o equivalente é `/plugin marketplace add contatomeensinaai-ai/me-ensina-ai-claude` e depois `/plugin install`.

Abra uma conversa nova e peça: **Abre o editor Me Ensina AI**.

Marketplace: `me-ensina-ai-claude`. Plugin: `me-ensina-ai-video-editor`. Este repositório usa somente manifestos Claude, sem `.codex-plugin`.

## Primeira abertura

A preparação inicial baixa bibliotecas públicas verificadas por SHA-256 e leva alguns minutos. **Nenhum modelo de IA é baixado nessa etapa.** As aberturas seguintes reaproveitam o preparo e sobem em segundos.

O pacote do runtime vem da release fixada em `launcher/releases.json`, com verificação de SHA-256 antes de executar qualquer coisa.

## Limitações conhecidas

Windows ARM, Linux, WSL e containers não são suportados. No Windows use disco local NTFS; caminhos de rede não funcionam.

Alguns botões de IA (sugerir palavras, imagens de apoio, restauração) dependem de uma CLI externa instalada na sua máquina e da sua própria conta. **Sem ela o editor funciona normalmente** para importar, cortar, legendar, estilizar e exportar.

## Versão Codex

Se você usa Codex em vez de Claude Code, o marketplace é outro: https://github.com/contatomeensinaai-ai/me-ensina-ai-codex

Evite ativar os dois editores na mesma conversa.

## Fonte e créditos

Fonte do editor, releases e licenças: https://github.com/contatomeensinaai-ai/me-ensina-ai-editor

Adaptado pela Me Ensina AI da base Timeline Studio de MartinDelophy; MIT original preservado. Avisos de terceiros no repositório principal.
