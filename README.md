# Vassole Smart Player IPTV

Player web de IPTV próprio, gratuito, leve e sem necessidade de ativação. Reproduz listas **M3U/M3U8** e contas **Xtream Codes** cadastradas pelo utilizador, com suporte a navegação espacial para controlo remoto (Smart TVs, TV Box) e rato/teclado.

> **Nota:** A aplicação é exclusivamente um reprodutor de mídia. Não inclui, fornece, vende nem indica canais, listas ou conteúdos. Código escrito do zero, sem dependências externas no servidor.

---

## Como executar

**Requisito:** [Node.js](https://nodejs.org/) 18 ou superior (zero dependências de pacotes para execução).

### Uso no computador (local)

```bash
node server.mjs
# ou: npm start
```

Abra `http://localhost:8080` no navegador (Chrome, Edge, Firefox ou Safari).

### Uso na Smart TV, TV Box ou telemóvel (mesma rede local)

```bash
node server.mjs --host 0.0.0.0
# ou: npm run start:lan
```

O terminal exibirá o endereço da máquina na rede local (ex.: `http://192.168.0.10:8080`). Basta abrir esse endereço no navegador da TV ou dispositivo móvel.

### Opções do servidor

Todas as opções podem ser passadas por linha de comando ou por variáveis de ambiente:

| Argumento CLI | Variável de ambiente | Padrão | Descrição |
|---|---|---|---|
| `--port <número>` | `PORT` | `8080` | Porta HTTP do servidor. |
| `--host <endereço>` | `HOST` | `127.0.0.1` | Interface de rede (`0.0.0.0` ou `::` expõe para a rede local). |
| `--allow-private` | `ALLOW_PRIVATE=1` | Desativado | Permite que o proxy aceda a IPs locais/privados (`127.x`, `10.x`, `192.168.x`, etc.). Necessário para servidores na própria rede (ex.: Tvheadend) e para o provedor de testes (`npm run dev`). |
| `--allow-host <nomes>` | `ALLOW_HOST` | — | Lista de domínios/nomes adicionais autorizados no cabeçalho `Host`, separados por vírgula (ex.: `--allow-host tv.casa,iptv.lan`). |
| `--root <pasta>` | `ROOT` | `public` | Pasta servida no lugar de `public/` (ex.: `dist/browser`, para testar o build). |

---

## Arquitetura do servidor e proxy local

Navegadores bloqueiam o acesso direto à maioria dos provedores IPTV devido à ausência de cabeçalhos CORS e ao bloqueio de conteúdo misto (`http` dentro de páginas `https`). O servidor local (`server.mjs`) resolve isso atuando em duas frentes:

1. **Servidor estático:** entrega a aplicação (`public/`) e expõe o endpoint de verificação `GET /api/health`.
2. **Proxy de mídia (`/proxy`):** encaminha pedidos de listas, guias (EPG) e streams.
   - **Reescrita de HLS:** descompacta e reescreve manifestos `.m3u8` (`#EXT-X-`) para que sub-playlists, segmentos `.ts` e chaves de criptografia (`URI="..."`) também passem pelo proxy, preservando `User-Agent` e `Referer`.
   - **Redirecionamentos e Range:** segue até 5 redirecionamentos HTTP (comum em balanceadores Xtream) e repassa cabeçalhos `Range` / `Content-Range` para avanço/recuo em VOD.

### Segurança do proxy (`lib/netguard.mjs`)

- **Isolamento de origem:** recusa requisições originadas de outros sites validando `Host`, `Origin` e `Sec-Fetch-Site`. Não emite cabeçalhos `Access-Control-Allow-Origin` abertos e protege contra ataques de *DNS rebinding*.
- **Proteção contra SSRF:** bloqueia por padrão conexões e redirecionamentos para endereços de loopback, redes privadas (IPv4/IPv6, CGNAT, link-local, multicast e IPv4 mapeado em IPv6), validando o IP resolvido no momento do `dns.lookup` (evita *DNS rebinding* entre checagem e conexão).
- **Prevenção de loop:** aceita apenas protocolos `http:` e `https:` e impede que o proxy aceda ao próprio servidor.

---

## Funcionalidades

| Área | Recursos principais |
|---|---|
| **Fontes e Playlists** | Suporte a contas **Xtream Codes** (servidor, utilizador, senha), **links M3U** e **ficheiros M3U** locais. Converte links `get.php?username=…&password=…` em contas Xtream automaticamente. Lê cabeçalhos por canal (`#EXTVLCOPT:http-user-agent`, `#EXTVLCOPT:http-referrer`, `#EXTHTTP`, sufixo Kodi `\|User-Agent=…&Referer=…`) e `tvg-shift`. Suporta múltiplas playlists com sincronização em segundo plano (Web Worker). |
| **TV ao Vivo** | Navegação por categorias, busca rápida, favoritos, pré-visualização com vídeo integrado, tela cheia, painel com programação atual/próxima e troca rápida de canal (setas, `Canal+/−` ou digitação numérica). Agrupa versões do mesmo canal (`SD`, `HD`, `FHD`, `4K`) numa única entrada, iniciando pela qualidade preferida e alternando automaticamente caso um stream falhe. |
| **Guia (EPG)** | Leitura de XMLTV (`.xml` e `.xml.gz`) em fluxo (*streaming*), sem carregar o ficheiro inteiro em memória. Associação automática por `tvg-id` ou nome normalizado do canal, com fallback para `get_short_epg` em contas Xtream. Grade temporal de 6 horas com indicador de horário atual e seleção de idioma preferido. |
| **Filmes e Séries (VOD)** | Filtro por categoria e idioma, ordenação (padrão, A–Z, recentes, avaliação), metadados via `get_vod_info` / `get_series_info` ou extração automática de temporadas/episódios (`S01E02`) em listas M3U. Retomada de reprodução de onde parou e reprodução automática do próximo episódio. Agrupa versões do mesmo título (Dublado, Legendado, Dual Áudio ou idiomas distintos) num único cartão. |
| **Player de Vídeo** | Motores **HLS** (`hls.js`), **MPEG-TS** (`mpegts.js`) e **nativo** (`MP4`, `WebM`, `MKV`). Deteta o formato pelos primeiros bytes (`Range: bytes=0-2047`) quando a URL não possui extensão. Seleção de faixas de áudio, legendas do stream, níveis de qualidade/versões, velocidade de reprodução (`0,5×` a `2×` em VOD) e proporção de tela (*Ajustar*, *Preencher*, *Esticar*). Ocultação automática da barra e do cursor após 5 s. |
| **Legendas Externas** | Carregamento de ficheiros ou links `.srt` e `.vtt` em filmes e séries. Deteção automática de codificação (`UTF-8`, `UTF-16 LE/BE` e `Windows-1252`), ajuste de sincronia em passos de `0,5 s`, personalização visual (tamanho, cor, fundo, posição) e persistência por filme/episódio no IndexedDB. |
| **Idiomas** | Deteção automática por atributos (`tvg-language`, `tvg-country`), prefixos no nome (`PT:`, `[EN]`, `\|FR\|`, `ES -`, `EX-YU:`) e categorias (`BR: Brazil General`, `Movies Spanish`). Permite definir idiomas preferidos, ocultar outros idiomas e limpar prefixos de região dos nomes exibidos. |
| **Categorias e Controlo Parental** | Organização de categorias em TV ao vivo, Filmes e Séries: reordenar, ocultar e bloquear com **PIN** (com atalho para bloquear categorias adultas). Itens bloqueados ficam ocultos de "Todos", da busca, do início e dos favoritos até o desbloqueio da sessão. |
| **Início e Busca** | Tela inicial com trilhos *Continuar assistindo*, *Canais recentes* e *Canais favoritos*. Busca global insensível a maiúsculas e acentos abrangendo canais, filmes, séries e programas do guia (em exibição ou nas próximas 24 h). |
| **Ajustes, Backup e PWA** | Configuração de proxy, `User-Agent`, formato ao vivo Xtream, ajuste de fuso do guia (`−3 h` a `+3 h`), atualização automática de lista e EPG, exportação/importação de backup em JSON e limpeza de dados. Instalável como **PWA** com cache offline da interface via Service Worker (`sw.js`). |

---

## Controlos (Teclado e Controlo Remoto)

| Tecla (Teclado / Controlo Remoto) | Ação |
|---|---|
| `Setas (↑ ↓ ← →)` | Navegação espacial entre elementos. Em tela cheia ao vivo (com barra oculta): `↑`/`↓` trocam de canal. Em VOD (barra oculta ou barra de progresso em foco): `←`/`→` recuam ou avançam 10 s. |
| `Enter` / `OK` | Selecionar ou reproduzir. Num canal já em pré-visualização, abre em tela cheia. |
| `Esc` / `Backspace` / `Voltar` (`Tizen 10009`, `webOS 461`) | Fecha diálogos, oculta a barra do player, sai da tela cheia para a pré-visualização ou retorna à barra lateral / ecrã anterior. Nos apps de TV, no ecrã Início, pergunta se deseja sair do app. |
| `Espaço` / `Play/Pause` | Pausar ou retomar a reprodução. |
| `Page Up` / `Page Down` / `Canal+` / `Canal−` | Canal anterior / próximo canal. |
| `0–9` (TV ao vivo em tela cheia) | Mudar diretamente para o canal pelo número. |

---

## Build para Android e Smart TVs

```bash
npm run build                        # todas as plataformas: browser, android, tizen, webos
node scripts/build.mjs tizen webos   # só as indicadas
npm run build:dev                    # sem minificar, com source map (depuração na TV)
```

Cada plataforma é gerada em `dist/<plataforma>/`:

- `js/app.js` e `js/sync-worker.js` num ficheiro cada (sem ES Modules), convertidos para **Chromium 56** — Samsung Tizen 4.0 e LG webOS 4 (modelos de 2018) em diante. A plataforma fica gravada no próprio ficheiro (`window.__PLATFORM__`).
- `hls.min.js` e `mpegts.js` passam pela mesma conversão; `styles.css` também (`inset` é expandido para `top/right/bottom/left`).
- Fora do navegador, o realce de foco fica sempre visível (`:focus-visible` → `:focus`), o manifesto PWA e o Service Worker não são incluídos, e o app acede aos provedores diretamente, sem `server.mjs`.
- `polyfills.js` completa o que falta nas TVs antigas (`replaceChildren`, `padStart`, `flat`, `matchAll`, `TextDecoderStream`).

Para testar a saída no computador: `node server.mjs --root dist/browser --port 8081 --allow-private`.

A camada `public/js/platform.js` deteta a plataforma (navegador, Android, Tizen, webOS), define o que cada uma permite (proxy, Web Worker, sair com Voltar), traduz as teclas do controlo remoto (incluindo o registo das teclas de mídia, números e coloridas na Samsung) e cria o motor de reprodução: no navegador, o motor web (`engine-web.js`: hls.js, mpegts.js e `<video>`); no Android, o ExoPlayer (`engine-android.js`); nas TVs Samsung, o AVPlay (`engine-tizen.js`). Os dois motores nativos partilham `engine-native.js` (estado da reprodução no formato do `<video>` e posição do vídeo atrás da página). O pacote LG (`.ipk`) é a próxima etapa.

### Android, Android TV, Google TV e Fire TV

Projeto Capacitor em `android/` (identificador `com.vassole.smartplayer`). Um único APK serve telemóvel, tablet, Android TV, Google TV e Fire TV (aparece no launcher da TV com o banner `res/drawable-xhdpi/banner.png`).

**Requisitos:** JDK 21 e Android SDK (API 36 é transferida pelo Gradle). Defina `JAVA_HOME` para o JDK 21; o caminho do SDK fica em `android/local.properties` (`sdk.dir=...`, fora do git).

```bash
npm run android:apk        # build web + sincroniza + APK de teste: android/app/build/outputs/apk/debug/app-debug.apk
```

**Instalar para testar:** com a depuração USB (ou por rede) ativa no aparelho, `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`. Também é possível copiar o APK para o aparelho e abri-lo (permita "instalar apps desconhecidas" para o gestor de ficheiros). No emulador, o computador responde em `10.0.2.2` (ex.: provedor de testes em `http://10.0.2.2:9100`).

**Proxy dentro do APK:** os pedidos da página a `/proxy` e `/api/health` são atendidos em Java (`NativeProxy.java`, `HlsRewriter.java`), com as mesmas regras do `server.mjs`: redirecionamentos, `Range`, `User-Agent`/`Referer` por canal e reescrita de HLS. Só a página do app os vê — nada fica aberto em porta de rede. Assim, no Android funcionam também os cabeçalhos por canal e a leitura do guia em fluxo, inclusive no Web Worker. **Player nativo (ExoPlayer / Media3):** no Android a reprodução usa o ExoPlayer (`NativePlayerPlugin.java` + `public/js/engine-android.js`), que decodifica por hardware formatos que o navegador não reproduz (HEVC/H.265 e, quando o aparelho suporta, AC-3/E-AC-3), mostra legendas embutidas em MKV/MP4 e envia `User-Agent`/`Referer` por canal diretamente ao provedor. O vídeo é desenhado atrás da página, no retângulo do palco do player (prévia ou tela cheia); a interface fica por cima. As legendas (do stream e externas) são desenhadas pelo app numa camada própria, com a aparência definida nos Ajustes. Em **Ajustes › Reprodução › Player de vídeo** é possível voltar ao motor web (hls.js/mpegts.js) caso algum canal não abra no nativo (vale ao reabrir o app).

**Versão de produção (Google Play):**

1. Crie a chave uma única vez e guarde-a fora do projeto, com cópia de segurança — sem ela não é possível publicar atualizações:
   `keytool -genkeypair -v -keystore C:/chaves/vassole.jks -alias vassole -keyalg RSA -keysize 4096 -validity 10000`
2. Crie `android/keystore.properties` (fica fora do git):
   ```properties
   storeFile=C:/chaves/vassole.jks
   storePassword=SENHA_DA_CHAVE
   keyAlias=vassole
   keyPassword=SENHA_DO_ALIAS
   ```
3. `npm run android:release` gera o `.aab` assinado (`android/app/build/outputs/bundle/release/`) para a Google Play e um `.apk` assinado para instalação direta.

A versão (`versionName`/`versionCode`) vem do `package.json` (1.2.3 → 10203).

### Samsung (Tizen)

Pacote `.wgt` para TVs Samsung de 2018 em diante (Tizen 4.0+). O build (`node scripts/build.mjs tizen`) gera em `dist/tizen/` o `config.xml` (app `VassolePly.SmartPlayer`, versão do `package.json`, privilégios `internet` e `tv.inputdevice`, acesso a qualquer endereço, para os provedores do utilizador), o `icon.png` e carrega `$WEBAPIS/webapis/webapis.js` antes do app.

**Player nativo (AVPlay):** na TV a reprodução usa o AVPlay da Samsung (`engine-tizen.js`), que decodifica por hardware HLS, MPEG-TS, MP4/MKV, HEVC e AC-3. O vídeo é desenhado no plano de vídeo da TV, atrás da página, no retângulo do palco do player. Faixas de áudio e legendas do stream aparecem nos menus do player; legendas externas (.srt/.vtt) são desenhadas pelo app. Ao sair do app com o botão Home, a reprodução é suspensa e retomada ao voltar. Em **Ajustes › Reprodução › Player de vídeo** é possível voltar ao motor web.

Limitações do AVPlay: não envia `Referer` por canal (o `User-Agent` sim); velocidade só 1× ou 2×; a qualidade do HLS é sempre automática.

**Requisitos (uma única vez):**

1. Instale o [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html) (versão com IDE ou só CLI). No **Package Manager**, em *Extension SDK*, instale **TV Extensions** e **Samsung Certificate Extension**. A pasta padrão é `C:\tizen-studio`; noutro lugar, defina `TIZEN_STUDIO`.
2. **Certificado Samsung:** em *Tools › Certificate Manager*, crie um perfil novo do tipo **Samsung**, tipo de aparelho **TV**, e entre com a sua conta Samsung. No certificado de distribuidor, adicione o **DUID** da TV (aparece ao ligar a TV no *Device Manager*, passo 4) — sem isso a TV recusa o pacote. Guarde o nome do perfil (ex.: `vassole`). O certificado e a senha ficam no Tizen Studio, fora deste projeto.
3. **Modo Desenvolvedor na TV:** em *Apps*, digite `1 2 3 4 5` com o controlo remoto, ligue **Developer mode**, informe o IP do computador e reinicie a TV (desligue da tomada por alguns segundos). O computador e a TV precisam estar na mesma rede.
4. Descubra o IP da TV (*Definições › Geral › Rede › Estado da rede*). Opcional: no *Device Manager* do Tizen Studio, adicione a TV pelo IP para ver o DUID.

**Empacotar e instalar:**

```bash
# PowerShell: $env:TIZEN_PROFILE="vassole"; $env:TIZEN_TV="192.168.1.50"; npm run tizen:run
TIZEN_PROFILE=vassole npm run tizen:package                     # gera e assina dist/VassoleSmartPlayer.wgt
TIZEN_PROFILE=vassole TIZEN_TV=192.168.1.50 npm run tizen:install
TIZEN_PROFILE=vassole TIZEN_TV=192.168.1.50 npm run tizen:run   # instala e abre na TV
```

**Depuração na TV:** gere com `node scripts/build.mjs tizen --dev` e use *Run As › Tizen Web Application* (depuração) no Tizen Studio, ou `sdb connect <IP>` e o Web Inspector do Chromium.

**Publicação na Samsung Apps (Seller Office):** precisa de conta de vendedor Samsung, certificado de distribuidor do tipo *Public* (no Certificate Manager), ícone de 512×423 px, capturas de ecrã de 1920×1080 e a política de privacidade. A Samsung revê apps de IPTV com atenção: a descrição deve deixar claro que o app não inclui canais nem conteúdo.

---

## Testes e desenvolvimento

### Executar suíte de testes unitários e de integração

```bash
npm test
```

O comando `npm test` executa em sequência:
- `test/unit.mjs` — leitores M3U, XMLTV em fluxo, deteção de cabeçalhos por canal e normalização Xtream.
- `test/lang.mjs` — deteção de idiomas, regiões, categorias e agrupamento de versões (dublado/legendado/dual).
- `test/subs.mjs` — descodificação de texto (`UTF-8`/`UTF-16`/`Windows-1252`), parser SRT/VTT e ajuste de sincronia.
- `test/proxy.mjs` — regras de bloqueio de IPs privados (`netguard`), proteção contra DNS rebinding/CORS, reescrita HLS e redirecionamentos do proxy.
- `test/polyfills.mjs` — complementos para TVs antigas, com os métodos nativos removidos.
- `test/build.mjs` — deteção de plataforma, teclas do controlo, e saída do build (sintaxe compatível com Chromium 56, script clássico, sem Service Worker, CSS convertido).
- `scripts/build-sw.mjs --check` — verifica se a lista de ficheiros e o hash de versão em `public/sw.js` estão atualizados (se alterar ficheiros em `public/`, execute `npm run build:sw`).

### Testes End-to-End (E2E) e provedor simulado

```bash
npm run mock                         # inicia o provedor simulado em http://127.0.0.1:9100
npm run dev                          # inicia o servidor em http://127.0.0.1:8080 com --allow-private
python3 test/e2e.py capturas         # executa 32 verificações no Chrome via Playwright
```

O provedor simulado (`test/mock-provider.mjs`) disponibiliza:
- Conta `demo` / `demo`: canais ao vivo, filmes, séries, guia XMLTV compactado (`.xml.gz`) e guia curto Xtream.
- Conta `idiomas` / `idiomas`: canais com prefixos de idioma, fallback automático de qualidade (`FHD` inativo → `SD/HD`), filmes em versões `[DUB]`/`[LEG]`/espanhol e categoria `Adultos` para teste de PIN.
- Lista `http://127.0.0.1:9100/m3u/extras.m3u`: testa cabeçalhos exigidos por canal (`Referer` e `User-Agent`), `tvg-shift` e canais com múltiplas qualidades.
- Legendas de teste em `/subs/oceano.srt` (`Windows-1252`) e `/subs/oceano.vtt` (`UTF-8`).
- Mídias de teste em `test/media/` (comandos `ffmpeg` documentados em `test/media/README.txt`).

---

## Estrutura do projeto

```text
server.mjs                Entrada CLI do servidor HTTP (Node 18+, zero dependências)
scripts/
  build-sw.mjs            Gera a lista de ficheiros (SHELL) e o hash de versão do Service Worker
  build.mjs               Gera dist/<plataforma>/ (esbuild, alvo Chromium 56) e o config.xml da Samsung
  tizen.mjs               Empacota (.wgt), instala e abre o app na TV Samsung (CLI do Tizen Studio)
android/                  Projeto Capacitor (APK/AAB): NativeProxy.java, HlsRewriter.java, NativePlayerPlugin.java (ExoPlayer), MainActivity.java
capacitor.config.json     Configuração do Capacitor (identificador, pasta web)
lib/
  app.mjs                 Servidor estático, endpoint /api/health e proxy com reescrita HLS
  netguard.mjs            Segurança do proxy (validação de origem/Host e bloqueio de IPs privados/SSRF)
public/
  index.html              Estrutura principal da SPA
  styles.css              Estilos e layout responsivo / TV
  manifest.webmanifest    Manifesto PWA
  sw.js                   Service Worker para cache offline da interface
  icons/                  Ícones da aplicação (SVG, PNG 192/512 e maskable)
  fonts/                  Fonte Atkinson Hyperlegible (SIL OFL 1.1)
  vendor/                 hls.min.js 1.7.4 e mpegts.js 1.8.2 (Apache-2.0)
  js/
    app.js                Inicialização, roteamento por hash, atalhos de teclado/controlo remoto e auto-update
    platform.js           Plataforma (navegador/Android/Tizen/webOS), capacidades, teclas e motor de reprodução
    engine-web.js         Motor de reprodução web: hls.js, mpegts.js e <video>, com recuperação de erros
    polyfills.js          Complementos para navegadores de TV antigos
    engine-android.js     Motor de reprodução do Android: ExoPlayer (plugin NativePlayer), vídeo atrás da página
    engine-tizen.js       Motor de reprodução da Samsung: AVPlay (webapis.avplay), vídeo no plano da TV
    engine-native.js      Base dos motores nativos: estado no formato do <video> e retângulo do vídeo
    db.js                 Armazenamento local em IndexedDB com migrações de esquema
    store.js              Estado global, playlists, favoritos, histórico, progresso e associação de EPG
    net.js                Cliente HTTP (roteamento via /proxy e descompactação de streams gzip)
    ui.js                 Utilitários de DOM, ícones SVG, modais, toasts e renderização paginada (chunked)
    util.js               Normalização de texto/canais, ranking de qualidade, hash e entidades HTML/Base64
    nav.js                Motor de navegação espacial 2D por setas
    lang.js               Deteção de idiomas por atributo/prefixo/categoria e agrupamento de versões VOD
    pin.js                Controlo parental e verificação de PIN (guardado como hash)
    m3u.js                Parser de listas M3U/M3U8 e extração de episódios/cabeçalhos
    xtream.js             Cliente da API Xtream Codes e conversor de links get.php
    xmltv.js              Parser XMLTV em fluxo (ReadableStream)
    sync.js               Coordenação de sincronização de playlists e EPG
    sync-worker.js        Web Worker para leitura e processamento de listas em segundo plano
    tasks.js              Gestão de tarefas em segundo plano e indicador visual de progresso
    player.js             Controlador do player (OSD, pré-visualização, troca de canal e fallback de versões)
    player-menus.js       Menus de seleção de qualidade/versão e velocidade de reprodução
    subs.js               Gestão de faixas de áudio e legendas (embutidas e externas) no player
    subs-core.js          Parser SRT/VTT, deteção de codificação e ajuste de tempo (sem DOM)
    views-common.js       Componentes partilhados entre ecrãs (cartões, barras de filtro, limpeza)
    views-home.js         Ecrã Início (Continuar assistindo, Recentes, Favoritos)
    views-live.js         Ecrã TV ao vivo (categorias, lista, pré-visualização e EPG lateral)
    views-guide.js        Ecrã Guia de programação (grade de 6 horas)
    views-vod.js          Grelha de Filmes e Séries
    views-detail.js       Detalhes de Filme e Série (temporadas, episódios e escolha de versão)
    views-search.js       Busca global (canais, VOD e programas do guia)
    views-admin.js        Gestão de Playlists, Ajustes e exportação/importação de Backup
    views-cats.js         Modal de organização de categorias (ordenar, ocultar e bloquear)
test/
  unit.mjs                Testes de M3U, XMLTV e Xtream
  lang.mjs                Testes de deteção de idiomas e versões
  subs.mjs                Testes de legendas e codificação de caracteres
  proxy.mjs               Testes de segurança e integração do servidor/proxy
  polyfills.mjs           Testes dos complementos para TVs antigas
  build.mjs               Testes do build e da camada de plataforma
  mock-provider.mjs       Servidor Xtream/M3U/XMLTV simulado para desenvolvimento e testes
  e2e.py                  Testes ponta a ponta automatizados com Playwright
  media/                  Streams e vídeos de teste (HLS, MPEG-TS e MP4)
```

---

## Limitações conhecidas e segurança

- **Suporte a codecs:** a descodificação de vídeo e áudio depende do navegador. Vídeo **HEVC (H.265)** e áudio **AC-3 / E-AC-3** não são suportados na maioria dos navegadores de computador; quando ocorrem, o player informa erro de codec.
- **Faixas embutidas em MP4/MKV:** navegadores baseados em Chromium (Chrome, Edge) geralmente não expõem faixas de legendas de texto nem faixas de áudio secundárias embutidas em contentores MP4/MKV na reprodução nativa — nesses casos, carregue uma legenda externa `.srt` ou `.vtt`. Legendas DVB/teletexto em MPEG-TS ao vivo e ficheiros `.ass`/`.ssa` ou `.zip` não são suportados.
- **Cabeçalhos por canal:** o envio de `User-Agent` e `Referer` específicos de um canal exige que o proxy local esteja ativo (os navegadores bloqueiam a alteração direta desses cabeçalhos via `fetch`).
- **Compatibilidade em Smart TVs:** aberto pelo navegador da TV (via `server.mjs`), requer suporte a ES Modules, IndexedDB e Media Source Extensions (MSE). O build (`npm run build`) gera uma versão para Chromium 56+ (TVs de 2018 em diante); nessas TVs mais antigas, o espaçamento entre alguns elementos pode ficar menor (sem `gap` em flexbox antes do Chromium 84) e guias `.xml.gz` exigem Chromium 80+ (use o endereço `.xml`). O pacote Android (`.apk`/`.aab`) já é gerado; os pacotes `.wgt` (Samsung) e `.ipk` (LG) ainda não.
- **Escopo atual:** não inclui *catch-up* / gravação (timeshift), multi-ecrã, pesquisa online de legendas nem múltiplos perfis de utilizador.
- **Segurança na rede local e dados:** ao iniciar com `--host 0.0.0.0`, qualquer dispositivo na mesma rede local pode utilizar o proxy para aceder à internet (IPs privados permanecem bloqueados, exceto com `--allow-private`). Utilize apenas em redes domésticas confiáveis. As credenciais das listas ficam guardadas no IndexedDB do navegador e nos ficheiros JSON de backup em texto simples; o PIN parental é guardado como hash simples (FNV-1a), adequado só como barreira de uso doméstico.

---

## Responsabilidade

O **Vassole Smart Player IPTV** é apenas um reprodutor de mídia de código aberto. O utilizador é inteiramente responsável por possuir o direito legal de acesso às listas e fontes que cadastrar na aplicação.
