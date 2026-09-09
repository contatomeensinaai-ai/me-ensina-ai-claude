# Componentes de terceiros

Fonte original: MartinDelophy/ai-video-editor, revisão `064677063ec618d6bd27e1adcfa6be078615dda2`. Licença MIT original preservada. Alterações Me Ensina AI também sob MIT, sem substituir as licenças de dependências.

A release de preparação inclui Node.js v22.23.2 arm64 e npm presentes na distribuição oficial, com licença Node e avisos integrados do npm. Tarball oficial: https://nodejs.org/dist/v22.23.2/node-v22.23.2-darwin-arm64.tar.gz. SHA-256: `61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6`.

As dependências da interface são instaladas diretamente do npm usando `editor-source/package-lock.json`, com integridade e scripts de instalação desativados. Os arquivos vendor são baixados diretamente da revisão fixa do upstream com SHA-256 em `vendor-downloads.json`. Não há binários FFmpeg/libav, modelos ou mídias de demonstração na release pública de preparação.

Entre as dependências obtidas no destino: `@ffmpeg/core` 0.12.10 (GPL-2.0-or-later, https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15), libav.js (LGPL/ISC conforme configuração, https://github.com/Yahweasel/libav.js), `@mediabunny/aac-encoder` 1.50.8 (MPL-2.0, https://github.com/Vanilagy/mediabunny), MediaPipe e ONNX Runtime. O lockfile e os avisos upstream são a referência exata de cada versão; não se deve interpretar o MIT da aplicação como licença dos componentes.

O diretório licenses/third-party contém avisos coletados do ambiente de desenvolvimento, incluindo ferramentas não distribuídas no runtime. Não é uma declaração de que todos esses pacotes sejam parte da release. Consulte também editor-source/MODEL_LICENSES.md para as restrições de modelos opcionais. Nenhum modelo é baixado pelo setup da distribuição.

Para redistribuir a aplicação já compilada com dependências, será necessário atender novamente às obrigações dos componentes efetivamente incluídos, inclusive fontes correspondentes quando exigidas. Este repositório distribui a preparação a partir do fonte; não oferece uma release comercial homologada desses modelos ou codecs.
