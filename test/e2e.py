"""Teste de ponta a ponta no Chrome contra o provedor simulado.
Pré-requisitos: node server.mjs (porta 8080) e node test/mock-provider.mjs (porta 9100).
Uso: python3 test/e2e.py [pasta_de_capturas]
"""
import sys, time, os
from playwright.sync_api import sync_playwright, expect

APP = os.environ.get('APP', 'http://127.0.0.1:8080')
MOCK = 'http://127.0.0.1:9100'
SHOTS = sys.argv[1] if len(sys.argv) > 1 else 'shots'
os.makedirs(SHOTS, exist_ok=True)
errors = []
results = []

def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('OK   ' if cond else 'FALHA') + f' {name} {detail}')

def wait_video_playing(page, sel, min_t=1.0, timeout=20):
    end = time.time() + timeout
    t = 0
    while time.time() < end:
        t = page.evaluate(f"(() => {{ const v = document.querySelector('{sel}'); return v ? v.currentTime : -1 }})()")
        if t and t > min_t:
            return t
        time.sleep(0.5)
    return t

def idle(page, timeout=30000):
    page.wait_for_function("document.getElementById('task').hidden", timeout=timeout)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900})
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(APP)
    expect(page.locator('h1')).to_have_text('Bem-vindo ao Vassole Smart Player IPTV', timeout=10000)
    page.screenshot(path=f'{SHOTS}/01-boas-vindas.png')
    ok('tela inicial sem playlist', True)

    # ---- Adicionar conta Xtream ----
    page.click('text=Adicionar playlist')
    page.fill('input[name=name]', 'Provedor de teste')
    page.fill('input[name=server]', MOCK)
    page.fill('input[name=username]', 'demo')
    page.fill('input[name=password]', 'demo')
    page.screenshot(path=f'{SHOTS}/02-adicionar.png')
    page.click('text=Adicionar e carregar')
    page.wait_for_function("location.hash === '#/home'", timeout=20000)
    page.wait_for_selector('.view-home .page-head p')
    meta = page.locator('.view-home .page-head p').inner_text()
    ok('sincronização Xtream', '5 canais' in meta and '3 filmes' in meta and '2 séries' in meta, meta)
    idle(page)
    n_epg = page.evaluate("""new Promise(r => { const q = indexedDB.open('sintonia'); q.onsuccess = () => { const t = q.result.transaction('epg').objectStore('epg').count(); t.onsuccess = () => r(t.result) } })""")
    ok('guia XMLTV gzip carregado', n_epg >= 5, f'{n_epg} registros (4 canais + alias)')

    # ---- TV ao vivo ----
    page.goto(APP + '/#/live')
    page.wait_for_selector('.ch-row')
    rows = page.locator('.ch-row')
    ok('lista de canais', rows.count() == 5, str(rows.count()))
    page.wait_for_function("document.querySelector('.ch-row .ch-now')?.textContent.length > 0")
    now1 = rows.nth(0).locator('.ch-now').inner_text()
    ok('programa atual por tvg-id', 'Canal Notícias' in now1, now1)
    now4 = rows.nth(3).locator('.ch-now').inner_text()
    ok('programa atual por nome (sem tvg-id)', 'Arena Mais' in now4, now4)
    rows.nth(0).click()
    t = wait_video_playing(page, '.preview video')
    ok('HLS na prévia (redirecionamento + proxy)', t > 1, f't={t:.1f}s')
    page.screenshot(path=f'{SHOTS}/03-ao-vivo.png')
    # canal sem guia XMLTV: usa get_short_epg
    rows.nth(4).focus()
    page.wait_for_function("document.querySelector('.epg-list')?.textContent.includes('guia curto')", timeout=8000)
    ok('guia curto Xtream (base64)', True)
    # tela cheia e troca de canal
    rows.nth(0).focus()
    page.keyboard.press('Enter')  # canal já em reprodução: abre a tela cheia
    page.wait_for_selector('#player:not([hidden])', timeout=5000)
    ok('tela cheia', page.locator('#player').is_visible())
    page.wait_for_function("document.querySelector('.osd-sub').textContent.includes('Agora')", timeout=8000)
    page.screenshot(path=f'{SHOTS}/04-player-ao-vivo.png')
    page.keyboard.press('Escape')  # esconde a barra
    time.sleep(0.3)
    page.keyboard.press('ArrowDown')  # próximo canal
    page.wait_for_function("document.querySelector('.osd-title').textContent.startsWith('2 ')", timeout=5000)
    t = wait_video_playing(page, '#player video', 0.8)
    ok('troca de canal com seta', t > 0.8, f't={t:.1f}s')
    page.keyboard.press('Escape'); time.sleep(0.2)
    page.keyboard.press('Escape')
    page.wait_for_selector('#player', state='hidden')
    ok('voltar à prévia', page.locator('.preview video').count() == 1)
    # favorito pelo painel
    page.locator('.ch-info button:has-text("Favoritar")').click()
    time.sleep(0.3)
    ok('favoritar canal', page.locator('.ch-row .ch-fav').count() == 1)

    # ---- MPEG-TS ----
    page.goto(APP + '/#/settings')
    page.click('.seg button:has-text("MPEG-TS")')
    page.goto(APP + '/#/live')
    page.wait_for_selector('.ch-row')
    page.locator('.ch-row').nth(2).click()
    t = wait_video_playing(page, '.preview video')
    ok('MPEG-TS na prévia (mpegts.js)', t > 1, f't={t:.1f}s')
    page.goto(APP + '/#/settings')
    page.click('.seg button:has-text("Automático") >> nth=1')

    # ---- Guia ----
    page.goto(APP + '/#/guide')
    page.wait_for_selector('.g-prog')
    ok('grade do guia', page.locator('.g-prog').count() >= 4 * 6, str(page.locator('.g-prog').count()))
    ok('programa em exibição destacado', page.locator('.g-prog.on').count() == 4)
    page.screenshot(path=f'{SHOTS}/05-guia.png')

    # ---- Filmes ----
    page.goto(APP + '/#/movies')
    page.wait_for_selector('.grid .card')
    ok('grade de filmes', page.locator('.grid .card').count() == 3)
    page.click('.seg button:has-text("Nota")')
    first = page.locator('.grid .card .cap').first.inner_text()
    ok('ordenar por nota', first == 'A Última Estação', first)
    page.screenshot(path=f'{SHOTS}/06-filmes.png')
    page.locator('.grid .card').first.click()
    page.wait_for_selector('.detail-body .meta')
    ok('detalhes do filme (get_vod_info)', 'Documentário' in page.locator('.detail-body').inner_text() or 'Drama' in page.locator('.detail-body').inner_text())
    page.screenshot(path=f'{SHOTS}/07-filme.png')
    page.click('.detail-body button:has-text("Assistir")')
    t = wait_video_playing(page, '#player video', 2)
    ok('filme MP4', t > 2, f't={t:.1f}s')
    page.evaluate("document.querySelector('#player video').currentTime = 40")
    time.sleep(1.5)
    page.mouse.move(800, 450)
    page.screenshot(path=f'{SHOTS}/08-player-filme.png')
    page.keyboard.press('Escape'); time.sleep(0.2); page.keyboard.press('Escape')
    page.wait_for_selector('#player', state='hidden')
    page.goto(APP + '/#/movies'); page.goto(APP + '/#/movie/203')
    page.wait_for_selector('.detail-body button:has-text("Retomar")', timeout=5000)
    ok('progresso salvo e retomada', True)

    # ---- Séries ----
    page.goto(APP + '/#/show/301')
    page.wait_for_selector('.ep')
    ok('temporadas e episódios (get_series_info)', page.locator('.seasons .chip').count() == 2 and page.locator('.ep').count() == 2)
    page.screenshot(path=f'{SHOTS}/09-serie.png')
    page.locator('.ep').nth(1).click()
    t = wait_video_playing(page, '#player video', 1)
    ok('episódio', t > 1, f't={t:.1f}s')
    page.evaluate("const v = document.querySelector('#player video'); v.currentTime = v.duration - 0.5")
    page.wait_for_function("document.querySelector('.osd-title')?.textContent.includes('T2 E1')", timeout=10000)
    ok('próximo episódio automático', True)
    page.keyboard.press('Escape'); time.sleep(0.2); page.keyboard.press('Escape')

    # ---- Início e busca ----
    page.goto(APP + '/#/home')
    page.wait_for_selector('.shelf')
    heads = page.locator('.shelf h2').all_inner_texts()
    ok('início com continuar, recentes e favoritos', {'Continuar assistindo', 'Canais recentes', 'Canais favoritos'} <= set(heads), str(heads))
    page.screenshot(path=f'{SHOTS}/10-inicio.png')
    page.goto(APP + '/#/search')
    page.fill('input[type=search]', 'noticias')
    page.wait_for_selector('.results .card')
    ok('busca sem acentos', 'Canal Notícias HD' in page.locator('.results').inner_text())

    # ---- Navegação por setas ----
    page.goto(APP + '/#/live')
    page.wait_for_selector('.ch-row')
    time.sleep(0.5)
    page.keyboard.press('ArrowDown')
    f1 = page.evaluate("document.activeElement.dataset.key")
    page.keyboard.press('ArrowLeft')
    f2 = page.evaluate("document.activeElement.className")
    page.keyboard.press('ArrowLeft')
    f3 = page.evaluate("document.activeElement.className")
    ok('setas: canais → categorias → menu', f1 and 'cat' in f2 and 'nav-btn' in f3, f'{f1} | {f2} | {f3}')
    page.keyboard.press('Escape')  # sai sem efeito no menu
    page.goto(APP + '/#/home')

    # ---- Link M3U (com guia url-tvg e stream sem extensão) ----
    page.goto(APP + '/#/playlists')
    page.click('text=Adicionar')
    page.click('.seg button:has-text("Link M3U")')
    page.fill('input[name=name]', 'Lista M3U')
    page.fill('input[name=url]', MOCK + '/m3u/list.m3u')
    page.click('text=Adicionar e carregar')
    page.wait_for_function("location.hash === '#/home'", timeout=20000)
    page.wait_for_selector('.view-home .page-head p')
    meta = page.locator('.view-home .page-head p').inner_text()
    ok('sincronização M3U', '5 canais' in meta and '3 filmes' in meta and '1 séries' in meta, meta)
    idle(page)
    page.goto(APP + '/#/live')
    page.wait_for_selector('.ch-row')
    page.locator('.ch-row').nth(3).click()
    t = wait_video_playing(page, '.preview video')
    ok('stream sem extensão (detecção pelo conteúdo)', t > 1, f't={t:.1f}s')
    page.wait_for_function("document.querySelectorAll('.ch-row .ch-now:not(:empty)').length >= 3", timeout=8000)
    ok('guia via url-tvg da M3U', True)
    page.goto(APP + '/#/show/' + page.evaluate("""new Promise(r => { const q = indexedDB.open('sintonia'); q.onsuccess = () => { const t = q.result.transaction('items').objectStore('items').getAll(); t.onsuccess = () => r(t.result.find(i => i.kind === 'series' && i.episodes).id) } })"""))
    page.wait_for_selector('.ep')
    ok('série montada a partir da M3U', page.locator('.seasons .chip').count() == 2)

    # ---- Link get.php vira Xtream ----
    page.goto(APP + '/#/playlists')
    page.click('text=Adicionar')
    page.click('.seg button:has-text("Link M3U")')
    page.fill('input[name=url]', MOCK + '/get.php?username=demo&password=demo&type=m3u_plus')
    page.click('text=Adicionar e carregar')
    page.wait_for_function("location.hash === '#/home'", timeout=20000)
    page.goto(APP + '/#/playlists')
    page.wait_for_selector('.pl-card')
    txt = page.locator('.pl-list').inner_text()
    ok('get.php convertido em Xtream', txt.count('Xtream ·') == 2, '')
    page.screenshot(path=f'{SHOTS}/11-playlists.png')
    page.goto(APP + '/#/settings')
    page.screenshot(path=f'{SHOTS}/12-ajustes.png', full_page=True)

    # ---- Celular ----
    m = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    mp = m.new_page()
    mp.goto(APP)  # base nova (contexto separado): só a tela de boas-vindas
    mp.screenshot(path=f'{SHOTS}/13-celular.png')
    m.close()
    b.close()

ignored = ('favicon', 'ERR_ABORTED', 'net::ERR_FAILED')
errs = [e for e in errors if not any(x in e for x in ignored)]
ok('sem erros de console', not errs, ' | '.join(errs[:5]))
failed = [r for r in results if not r[1]]
print(f'\n{len(results) - len(failed)}/{len(results)} verificações passaram')
sys.exit(1 if failed else 0)
