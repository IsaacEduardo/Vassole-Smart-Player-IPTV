# Changelog

Todas as mudanças relevantes do Vassole Smart Player IPTV. As versões seguem [SemVer](https://semver.org/lang/pt-BR/); a versão de todos os pacotes (APK/AAB, `.wgt`, `.ipk`, servidor e service worker) vem do `package.json`.

## [1.1.0] — 2026-11-10

Primeira versão com apps para Android, Android TV, TVs Samsung e TVs LG.

### Plataformas
- **Camada de plataforma** (`platform.js`): deteta navegador, Android, Samsung (Tizen) e LG (webOS); define o que cada uma permite; traduz as teclas do controlo remoto e cria o motor de reprodução.
- **Build para TVs** (`scripts/build.mjs`, esbuild): `dist/<plataforma>/` com código convertido para Chromium 56 (TVs de 2018 em diante), polyfills e foco sempre visível.
- **Android / Android TV / Google TV / Fire TV** (Capacitor): um só APK, com banner no launcher da TV e proxy nativo no próprio APK (`/proxy`, sem porta de rede aberta). A assinatura de produção usa `android/keystore.properties`, fora do git.
- **Player nativo no Android** (ExoPlayer / Media3): decodificação por hardware (HEVC; AC-3 quando o aparelho suporta), `User-Agent`/`Referer` por canal, faixas de áudio e legenda, níveis de qualidade.
- **Samsung** (Tizen 4.0+): pacote `.wgt` e player nativo AVPlay, com faixas de áudio e legendas do stream e suspensão ao sair do app.
- **LG** (webOS 4.0+): pacote `.ipk`. O HLS toca diretamente no player da TV; se a TV recusar o stream, passa ao hls.js. A reprodução pausa em segundo plano.
- Scripts `npm run android:*`, `tizen:*` e `webos:*` para empacotar, instalar e depurar.
- Ajustes › Reprodução › Player de vídeo: nativo ou web, em cada plataforma.

### Reprodução
- Teclas de mídia do controlo: Parar fecha o player; ⏩/⏪ avançam ou voltam 30 s.
- Legendas externas e do stream desenhadas pelo app quando o vídeo é nativo, com a aparência dos Ajustes.
- Erro HTTP 4xx troca logo para outra versão do canal, sem novas tentativas.

### Outros
- A versão aparece em Ajustes › Sobre, com um resumo de privacidade.
- Pasta `store/`: textos das lojas (pt-BR e en), imagens exigidas por loja e política de privacidade.
- Corrigido: "null" escrito no painel de canais sem outras qualidades.

## [1.0.0] — 2026-11-07

Primeira versão como **Vassole Smart Player IPTV** (antes "Sintonia"). Identificadores internos mantidos para não perder dados: banco IndexedDB `sintonia`, identificador dos backups, sal do PIN e prefixo do cache.

### Segurança e base
- Proxy endurecido: recusa pedidos de outros sites e `Host` desconhecido (DNS rebinding); bloqueia loopback, redes privadas e link-local, inclusive após redirecionamentos. Opções `--allow-private` e `--allow-host`.
- Servidor dividido em `lib/app.mjs` e `lib/netguard.mjs`.
- Banco com migrações por versão. A sincronização grava primeiro e só depois remove, para não esvaziar a playlist numa falha.
- Corrigido: exportar backup.

### Legendas, idiomas e versões
- Legendas externas SRT/VTT (arquivo ou link), com deteção de codificação, sincronia em passos de 0,5 s e aparência configurável. Legenda e ajuste guardados por filme/episódio.
- Idioma preferido de áudio e de legenda.
- Deteção de idioma (atributos, prefixos como `PT:`/`[EN]`, nomes de categoria) e de versões dublada/legendada/dual. Filtro por idioma em TV ao vivo, Guia, Filmes e Séries, com as versões do mesmo título num só cartão.

### Player e navegação
- Qualidade (níveis do HLS e versões do canal), velocidade, barra de progresso pelo controlo remoto.
- Mesmo canal em SD/HD/FHD/4K numa só linha, com troca automática se uma versão falhar.
- `User-Agent`/`Referer` por canal (M3U `#EXTVLCOPT`, `#EXTHTTP`, `url|User-Agent=…`), `tvg-shift` e ajuste de horário do guia.
- Controlo parental: organizar, ocultar e bloquear categorias com PIN; atalho para bloquear categorias adultas.
- Busca inclui os programas do guia.
