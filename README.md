# Sintonia

Player de IPTV próprio, gratuito e sem ativação. Reproduz listas M3U e contas Xtream Codes que o usuário cadastra. Não inclui, vende nem indica canais ou conteúdo.

Código escrito do zero. Não reutiliza código, marca, ícones nem textos do IBO Player; apenas o modelo de uso (cadastrar a fonte do provedor e navegar por TV ao vivo, guia, filmes e séries) serviu de referência.

## Como usar

Requisito: Node.js 18 ou superior. Não há dependências para instalar.

```
node server.mjs
```

Abra `http://localhost:8080` no Chrome, Edge, Firefox ou Safari.

Para usar na TV ou no celular da mesma rede:

```
node server.mjs --host 0.0.0.0
```

O terminal mostra o endereço (por exemplo `http://192.168.0.10:8080`). Abra esse endereço no navegador da TV. Opções: `--port 8080` e `--host 127.0.0.1` (padrão).

### Por que existe um servidor local

Navegadores bloqueiam o acesso direto à maioria dos provedores: as respostas não têm cabeçalhos CORS e os streams costumam ser `http`. O `server.mjs` entrega o app e faz proxy de playlists, guias e streams. Nas playlists HLS, ele reescreve os endereços de segmentos e chaves e segue redirecionamentos (comum em painéis Xtream). O modo do proxy fica em Ajustes: Automático, Sempre ou Desligado.

## Funções

| Área | O que faz |
|---|---|
| Fontes | Conta Xtream Codes (servidor, usuário, senha), link M3U, arquivo M3U. Links `get.php?username=…&password=…` viram conta Xtream automaticamente. Várias playlists, uma ativa por vez. |
| TV ao vivo | Categorias, filtro, favoritos, prévia com reprodução, painel com programa atual e próximos, tela cheia, troca de canal por setas, Canal+/−, ou digitando o número. |
| Guia (EPG) | XMLTV (inclusive `.xml.gz`), lido em fluxo, sem carregar o arquivo inteiro na memória. Associação por `tvg-id` ou pelo nome do canal. Para Xtream sem XMLTV para o canal, usa `get_short_epg`. Grade de 6 horas com linha do horário atual. |
| Filmes | Categorias, filtro, ordenação (padrão, A–Z, recentes, nota), detalhes via `get_vod_info`, retomar de onde parou. |
| Séries | Temporadas e episódios via `get_series_info` ou montados a partir de nomes `S01E02` em listas M3U, progresso por episódio, próximo episódio automático. |
| Início | Continuar assistindo, canais recentes, favoritos. |
| Busca | Canais, filmes e séries, sem diferenciar acentos e maiúsculas. |
| Player | HLS (hls.js), MPEG-TS (mpegts.js) e nativo (MP4, WebM, MKV conforme o navegador). Detecta o formato pelo conteúdo quando o link não tem extensão. Faixas de áudio, legendas, proporção (ajustar, preencher, esticar). |
| Ajustes | Proxy, User-Agent, formato ao vivo Xtream (HLS ou MPEG-TS), atualização automática da lista e do guia, backup e restauração em JSON, limpeza de dados. |
| PWA | Instalável e abre sem rede (somente a interface) quando servido em `localhost` ou `https`. |

## Controles

| Tecla (teclado / controle remoto) | Ação |
|---|---|
| Setas | Navegar. Na tela cheia ao vivo, ↑/↓ trocam de canal; em filmes, ←/→ voltam ou avançam 10 s |
| Enter / OK | Abrir ou reproduzir. Num canal já em prévia, abre a tela cheia |
| Esc, Backspace, Voltar (Tizen 10009, webOS 461) | Voltar: fecha diálogo, esconde a barra do player, sai da tela cheia, volta ao menu |
| Espaço, Play/Pause | Pausar e continuar |
| Page Up / Page Down, Canal+ / Canal− | Trocar de canal |
| 0–9 (ao vivo) | Ir para o canal pelo número |

## Limitações conhecidas

- **Codecs:** a reprodução depende do navegador. HEVC/H.265 e áudio AC-3/E-AC-3 não funcionam na maioria dos navegadores de computador; nesses casos o player mostra o erro de codec.
- **Navegadores de TV:** o app usa módulos JavaScript, IndexedDB e Media Source Extensions. Navegadores de TVs antigas podem não ter esses recursos. Não há pacote nativo Tizen (Samsung) ou webOS (LG) nesta versão.
- **Fora desta versão:** catch-up/arquivo, controle parental, multi-tela, legendas externas, perfis.
- **Segurança:** com `--host 0.0.0.0`, qualquer aparelho da rede local pode usar o proxy. Use só em redes confiáveis. As credenciais ficam no IndexedDB do navegador, sem criptografia; o backup exportado também contém as credenciais.

## Testes

```
node test/unit.mjs                        # leitores de M3U, XMLTV e Xtream
node test/mock-provider.mjs &             # provedor simulado na porta 9100 (sem CORS)
node server.mjs &
python3 test/e2e.py capturas              # 32 verificações no Chrome (Playwright)
```

O provedor simulado usa vídeos de teste que devem estar em `test/media/` (gerados com ffmpeg; ver `test/media/README.txt`).

## Estrutura

```
server.mjs              servidor estático + proxy (sem dependências)
public/
  index.html, styles.css, sw.js, manifest.webmanifest
  js/app.js             inicialização, rotas, teclas
  js/views.js           Início, TV ao vivo, Guia, Filmes, Séries, Busca
  js/views-admin.js     Playlists e Ajustes
  js/player.js          player e barra de controles
  js/nav.js             navegação espacial por setas
  js/store.js           estado, favoritos, histórico, guia
  js/db.js              IndexedDB
  js/m3u.js, xtream.js, xmltv.js   leitores das fontes
  js/sync.js, sync-worker.js, tasks.js   sincronização em segundo plano
  vendor/               hls.js 1.7.4 e mpegts.js 1.8.2 (Apache-2.0)
  fonts/                Atkinson Hyperlegible (SIL OFL 1.1)
test/                   testes e provedor simulado
```

## Responsabilidade

O Sintonia é um reprodutor de mídia. O usuário é responsável por ter direito de acesso às fontes que cadastrar.
