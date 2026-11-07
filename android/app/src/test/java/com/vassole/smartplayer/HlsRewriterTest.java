package com.vassole.smartplayer;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Mesmos casos de rewriteHls em test/proxy.mjs (servidor do navegador). */
public class HlsRewriterTest {
    @Test
    public void reescreveSegmentosEChaves() {
        String pl = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k.key\"\n#EXTINF:2,\nseg0.ts\n";
        String out = HlsRewriter.rewrite(pl, "http://cdn.example/a/index.m3u8", "UA", null);
        assertTrue(out.contains("URI=\"/proxy?u=" + HlsRewriter.enc("http://cdn.example/a/k.key") + "&ua=UA\""));
        assertTrue(out.contains("/proxy?u=" + HlsRewriter.enc("http://cdn.example/a/seg0.ts") + "&ua=UA"));
        assertTrue(out.startsWith("#EXTM3U\n"));
    }

    @Test
    public void levaOReferer() {
        String out = HlsRewriter.rewrite("#EXTM3U\n#EXTINF:2,\nseg.ts\n", "http://c.example/", "UA", "https://r.example/");
        assertTrue(out.contains("&ref=https%3A%2F%2Fr.example%2F"));
    }

    @Test
    public void codificaComoEncodeURIComponent() {
        assertEquals("a%20b%2Bc%2F%3F(x)!", HlsRewriter.enc("a b+c/?(x)!"));
    }

    @Test
    public void caminhoAbsolutoEOutroServidor() {
        String out = HlsRewriter.rewrite("#EXT-X-VERSION:3\n/x/seg.ts\nhttps://outro.example/y.ts", "http://c.example/a/b.m3u8", null, null);
        assertTrue(out.contains(HlsRewriter.enc("http://c.example/x/seg.ts")));
        assertTrue(out.contains(HlsRewriter.enc("https://outro.example/y.ts")));
    }

    @Test
    public void listaDeCanaisNaoEhHls() {
        assertFalse(HlsRewriter.isHls("#EXTM3U\n#EXTINF:-1,Canal\nhttp://x/1.ts"));
        assertTrue(HlsRewriter.isHls("#EXTM3U\n#EXT-X-TARGETDURATION:2"));
    }
}
