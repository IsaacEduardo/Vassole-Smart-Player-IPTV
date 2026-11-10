# Imagens exigidas por loja

✅ já existe no projeto · ⬜ falta criar

Os tamanhos abaixo são os pedidos pelas lojas quando esta lista foi feita. Confira a página de envio de cada loja antes de publicar, porque as exigências mudam.

## Regras para as capturas de ecrã (todas as lojas)

As lojas recusam apps de IPTV cujas capturas mostram canais, logotipos de emissoras, filmes ou séries reais. Faça as capturas com o **provedor de teste** do projeto (`node test/mock-provider.mjs`, conta `demo`/`demo` em `http://127.0.0.1:9100`), que só tem nomes e vídeos fictícios. Não use a conta `idiomas`: ela tem nomes de emissoras reais para testar a deteção de idioma.

Primeira versão das capturas (1920×1080, sem capas): `store/capturas/`.

Telas sugeridas, nesta ordem:
1. Início, com "Continuar assistindo" e favoritos
2. TV ao vivo: lista de canais com a prévia e o guia (agora/depois)
3. Player em tela cheia com a barra de controles
4. Filmes ou séries: catálogo e página de detalhes
5. Menu de legendas e áudio (idiomas)
6. Ajustes (controle parental e legendas)

## Google Play (Android e Android TV)

| Imagem | Tamanho | Estado |
|---|---|---|
| Ícone da loja | 512×512 PNG 32 bits, até 1 MB | ✅ `public/icons/icon-512.png` |
| Gráfico de destaque (feature graphic) | 1024×500 JPG ou PNG 24 bits, sem transparência | ⬜ |
| Capturas de celular | 2 a 8; lado menor ≥ 320 px, lado maior ≤ 3840 px, proporção até 2:1 (16:9 recomendado, ≥ 1080 px) | ⬜ |
| Banner da Android TV (na loja) | 1280×720 PNG ou JPG | ⬜ (pode partir de `android/app/src/main/res/drawable-xhdpi/banner.png`) |
| Capturas da Android TV | pelo menos 1; 1920×1080 (16:9) | ✅ `store/capturas/` |
| Banner dentro do app (launcher da TV) | 320×180 (xhdpi) | ✅ `android/app/src/main/res/drawable-xhdpi/banner.png` |
| Ícone do launcher | adaptativo (vetor) | ✅ `android/app/src/main/res/drawable/ic_launcher_*.xml` |

Também exigido: link público da política de privacidade (`store/politica-de-privacidade.md`) e o formulário de segurança dos dados ("Data safety"): declare que **nenhum dado é coletado nem compartilhado**.

## Samsung Seller Office (TVs Samsung / Tizen)

| Imagem | Tamanho | Estado |
|---|---|---|
| Ícone do app na loja | 512×423 PNG | ⬜ |
| Ícone dentro do pacote | `icon.png` na raiz do `.wgt` | ✅ gerado pelo build a partir de `public/icons/icon-512.png` |
| Capturas de ecrã | 1920×1080 JPG ou PNG (a quantidade mínima é indicada no Seller Office) | ✅ `store/capturas/` |

Também exigido: política de privacidade, descrição em cada idioma de publicação e um vídeo ou instruções de teste para a revisão. Para a revisão, envie uma lista M3U de teste com streams livres (a Samsung testa a reprodução).

## LG Seller Lounge (TVs LG / webOS)

| Imagem | Tamanho | Estado |
|---|---|---|
| Ícone do pacote | 80×80 PNG | ✅ `webos/icon.png` |
| Ícone grande do pacote | 130×130 PNG | ✅ `webos/largeIcon.png` |
| Imagem de abertura (splash) | 1920×1080 PNG | ✅ `webos/splash.png` |
| Ícone e imagens da loja | conforme o formulário do Seller Lounge (ícone quadrado e imagem de destaque) | ⬜ |
| Capturas de ecrã | 1920×1080 JPG ou PNG | ✅ `store/capturas/` |

Também exigido: política de privacidade e, para a revisão, uma lista M3U de teste com streams livres e instruções de uso.

## Para todas as lojas

- Lista de teste para a revisão: uma M3U pública com streams de uso livre (por exemplo, vídeos de demonstração com licença aberta). Nunca envie a conta de um provedor pago.
- Textos: `store/textos-pt-BR.md` e `store/texts-en.md`.
