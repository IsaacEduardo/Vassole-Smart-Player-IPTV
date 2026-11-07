# Vassole Smart Player IPTV

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

O terminal mostra o endereço (por exemplo `http://192.168.0.10:8080`). Abra esse endereço no navegador da TV. Opções:

| Opção | Efeito |
|---|---|
| `--port 8080` | Porta do servidor (padrão 8080). |
| `--host 127.0.0.1` | Interface de rede (padrão `127.0.0.1`; `0.0.0.0` abre para a rede local). |
| `--allow-private` | Permite que o proxy acesse endereços locais e da rede privada (`127.x`, `192.168.x`, `10.x` etc.). Necessário se o provedor estiver na sua própria rede (ex.: um servidor Tvheadend) e para o provedor de teste. Também por `ALLOW_PRIVATE=1`. |
| `--allow-host nome` | Aceita abrir o app por outro nome além de `localhost`, dos IPs do computador e do nome da máquina (ex.: `--allow-host tv.casa`). |

### Por que existe um servidor local

Navegadores bloqueiam o acesso direto à maioria dos provedores: as respostas não têm cabeçalhos CORS e os streams costumam ser `http`. O `server.mjs` entrega o app e faz proxy de playlists, guias e streams. Nas playlists HLS, ele reescreve os endereços de segmentos e chaves e segue redirecionamentos (comum em painéis Xtream). O modo do proxy fica em Ajustes: Automático, Sempre ou Desligado.

Proteções do proxy:

- Só atende o próprio app: recusa pedidos vindos de outros sites (`Origin`, `Sec-Fetch-Site`) e com nome de servidor desconhecido (proteção contra DNS rebinding). Não envia cabeçalhos CORS.
- Não acessa endereços locais ou privados, nem por redirecionamento. O endereço é verificado no momento da conexão. Use `--allow-private` para liberar.
- Aceita apenas `http` e `https`, e nunca acessa o próprio servidor.

## Funções

| Área | O que faz |
|---|---|
| Fontes | Conta Xtream Codes (servidor, usuário, senha), link M3U, arquivo M3U. Links `get.php?username=…&password=…` viram conta Xtream automaticamente. Várias playlists, uma ativa por vez. Nas listas M3U, cabeçalhos por canal (`#EXTVLCOPT:http-user-agent`/`http-referrer`, `#EXTHTTP`, `url|User-Agent=…&Referer=…`) e `tvg-shift`. |
| Idiomas | Idioma detectado ao atualizar a lista: atributos `tvg-language`/`tvg-country`, prefixos de região no nome (`PT:`, `[EN]`, `|FR|`, `ES -`, `EX-YU:`) e nomes de idioma ou país na categoria (`Movies Spanish`, `BR: Brazil General`, `Bolivia`). Filtro de idioma em TV ao vivo, Guia, Filmes e Séries. Nos Ajustes: idiomas preferidos (aparecem primeiro), esconder os demais e mostrar os nomes sem o prefixo de região. |
| TV ao vivo | Categorias, filtro, favoritos, prévia com reprodução, painel com programa atual e próximos, tela cheia, troca de canal por setas, Canal+/−, ou digitando o número. O mesmo canal em várias qualidades (SD, HD, FHD, 4K) vira uma só linha: começa pela maior (ou a mais leve, nos Ajustes) e, se a versão falhar, passa para a próxima sozinho. |
| Categorias | Botão **Organizar** em TV ao vivo, Filmes e Séries (e nos Ajustes): ordenar, ocultar e bloquear com PIN, com atalho para bloquear as categorias adultas. Categorias bloqueadas aparecem com cadeado e pedem o PIN; os itens delas ficam fora de “Todos”, da busca e dos favoritos até serem liberados. |
| Guia (EPG) | XMLTV (inclusive `.xml.gz`), lido em fluxo, sem carregar o arquivo inteiro na memória. Associação por `tvg-id` ou pelo nome do canal. Para Xtream sem XMLTV para o canal, usa `get_short_epg`. Grade de 6 horas com linha do horário atual. Em guias com vários idiomas, usa o título e a descrição no idioma preferido. |
| Filmes | Categorias, filtro, ordenação (padrão, A–Z, recentes, nota), detalhes via `get_vod_info`, retomar de onde parou. Versões do mesmo título (dublado, legendado, dual áudio ou outro idioma, por `[DUB]`, `(LEG)`, `Dublado`, `Legendado`, `DUAL` ou pela categoria) aparecem num só cartão; a versão é escolhida ao abrir e pode ser trocada no detalhe. |
| Séries | Temporadas e episódios via `get_series_info` ou montados a partir de nomes `S01E02` em listas M3U, progresso por episódio, próximo episódio automático. Versões agrupadas como nos filmes. |
| Início | Continuar assistindo, canais recentes, favoritos. |
| Busca | Canais, filmes, séries e programas do guia (em exibição ou nas próximas 24 h), sem diferenciar acentos e maiúsculas. |
| Player | HLS (hls.js), MPEG-TS (mpegts.js) e nativo (MP4, WebM, MKV conforme o navegador). Detecta o formato pelo conteúdo quando o link não tem extensão. Faixas de áudio, legendas do stream, qualidade (níveis do HLS e versões do canal), velocidade em filmes e episódios (0,5× a 2×), proporção (ajustar, preencher, esticar). Barra de progresso operável pelo controle remoto. O cursor do mouse some junto com a barra. |
| Legendas | Em filmes e episódios, legenda externa `.srt` ou `.vtt` carregada de um arquivo ou de um link (pelo botão de legendas do player). Codificação detectada (UTF-8, UTF-16 ou Windows-1252). Sincronia em passos de 0,5 s. A legenda e o ajuste ficam salvos por filme ou episódio e voltam ao reabrir. A legenda sobe quando a barra do player aparece. |
| Ajustes | Proxy, User-Agent, formato ao vivo Xtream (HLS ou MPEG-TS), legendas (tamanho, cor, fundo, posição), idioma preferido de legenda e de áudio (aplicado quando o stream traz faixas nesse idioma), qualidade inicial dos canais, ajuste de horário do guia (−3 h a +3 h), controle parental (PIN), atualização automática da lista e do guia, backup e restauração em JSON, limpeza de dados. |
| PWA | Instalável e abre sem rede (somente a interface) quando servido em `localhost` ou `https`. |

## Controles

| Tecla (teclado / controle remoto) | Ação |
|---|---|
| Setas | Navegar. Na tela cheia ao vivo, ↑/↓ trocam de canal; em filmes, ←/→ voltam ou avançam 10 s (também com a barra de progresso em foco) |
| Enter / OK | Abrir ou reproduzir. Num canal já em prévia, abre a tela cheia |
| Esc, Backspace, Voltar (Tizen 10009, webOS 461) | Voltar: fecha diálogo, esconde a barra do player, sai da tela cheia, volta ao menu |
| Espaço, Play/Pause | Pausar e continuar |
| Page Up / Page Down, Canal+ / Canal− | Trocar de canal |
| 0–9 (ao vivo) | Ir para o canal pelo número |

## Limitações conhecidas

- **Codecs:** a reprodução depende do navegador. HEVC/H.265 e áudio AC-3/E-AC-3 não funcionam na maioria dos navegadores de computador; nesses casos o player mostra o erro de codec.
- **Navegadores de TV:** o app usa módulos JavaScript, IndexedDB e Media Source Extensions. Navegadores de TVs antigas podem não ter esses recursos. Não há pacote nativo Tizen (Samsung) ou webOS (LG) nesta versão.
- **Legendas e faixas embutidas:** o Chrome e o Edge não expõem as legendas de texto nem as faixas de áudio extras gravadas dentro de arquivos MP4/MKV; nesses casos, use uma legenda externa. Legendas DVB e teletexto em streams MPEG-TS ao vivo não são exibidas. Legendas `.ass`/`.ssa` e arquivos `.zip` não são aceitos (extraia o `.srt`). As legendas externas não entram no backup.
- **Cabeçalhos por canal:** o User-Agent e o Referer de cada canal só são aplicados com o proxy ativo (o navegador não deixa a página definir esses cabeçalhos).
- **PIN:** é uma barreira para uso doméstico, guardada como hash neste aparelho. Quem tiver acesso ao navegador pode apagar os dados do app.
- **Fora desta versão:** catch-up/arquivo, multi-tela, busca de legendas on-line, perfis.
- **Segurança:** com `--host 0.0.0.0`, qualquer aparelho da rede local pode usar o proxy para acessar a internet (endereços privados continuam bloqueados, salvo com `--allow-private`). Use só em redes confiáveis. As credenciais ficam no IndexedDB do navegador, sem criptografia; o backup exportado também contém as credenciais.

## Testes

```
npm run build:sw                          # depois de alterar arquivos em public/ (o npm test acusa se esquecer)
npm test                                  # leitores, idiomas, legendas, proxy e lista do service worker
node test/mock-provider.mjs &             # provedor simulado em 127.0.0.1:9100 (sem CORS)
node server.mjs --allow-private &         # o provedor de teste é local, por isso --allow-private
python3 test/e2e.py capturas              # 32 verificações no Chrome (Playwright)
```

O provedor simulado tem duas contas: `demo`/`demo` (dados básicos, usados pelo teste E2E) e `idiomas`/`idiomas` (os mesmos dados, mais canais com prefixo de região e um filme em versões dublada, legendada e em espanhol). A lista `http://127.0.0.1:9100/m3u/extras.m3u` testa cabeçalhos por canal (um canal só responde com o Referer e o User-Agent certos), `tvg-shift` e o mesmo canal em HD e SD; na conta `idiomas`, a versão FHD de “PT: RTP Teste” não responde, para testar a troca automática, e há uma categoria “Adultos” para testar o PIN. Usa vídeos de teste que devem estar em `test/media/` (gerados com ffmpeg; ver `test/media/README.txt`).

## Estrutura

```
server.mjs              linha de comando do servidor (sem dependências)
scripts/build-sw.mjs    gera a lista de arquivos e a versão do service worker (npm run build:sw)
lib/app.mjs             servidor estático + proxy
lib/netguard.mjs        regras de segurança do proxy (origem, destinos bloqueados)
public/
  index.html, styles.css, sw.js, manifest.webmanifest
  js/app.js             inicialização, rotas, teclas
  js/views-common.js    partes compartilhadas das telas (cartões, categorias, limpeza)
  js/views-home.js      Início
  js/views-live.js      TV ao vivo
  js/views-guide.js     Guia
  js/views-vod.js       Filmes e Séries (grade)
  js/views-detail.js    detalhe de filme e de série
  js/views-search.js    Busca
  js/views-admin.js     Playlists, Ajustes e backup
  js/views-cats.js      organizar categorias (ordem, ocultar, bloquear)
  js/pin.js             PIN do controle parental
  js/player.js          player e barra de controles
  js/player-menus.js    menus de qualidade e velocidade
  js/subs.js            legendas e faixas de áudio no player (menus, legenda externa, sincronia, aparência)
  js/subs-core.js       leitura de SRT/VTT, codificação e ajuste de tempo (sem DOM, testável)
  js/lang.js            idiomas: nomes, códigos, detecção por prefixo/categoria e versões dublada/legendada
  js/nav.js             navegação espacial por setas
  js/store.js           estado, favoritos, histórico, guia
  js/db.js              IndexedDB, com migrações por versão (MIGRATIONS)
  js/m3u.js, xtream.js, xmltv.js   leitores das fontes
  js/sync.js, sync-worker.js, tasks.js   sincronização em segundo plano
  vendor/               hls.js 1.7.4 e mpegts.js 1.8.2 (Apache-2.0)
  fonts/                Atkinson Hyperlegible (SIL OFL 1.1)
test/                   testes e provedor simulado
```

## Responsabilidade

O Vassole Smart Player IPTV é um reprodutor de mídia. O usuário é responsável por ter direito de acesso às fontes que cadastrar.
