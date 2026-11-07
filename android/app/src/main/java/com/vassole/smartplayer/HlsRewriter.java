package com.vassole.smartplayer;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URLEncoder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reescreve playlists HLS para que segmentos, chaves e sub-playlists também passem pelo proxy
 * do app (/proxy), levando o User-Agent e o Referer do canal. Mesma regra de rewriteHls em
 * lib/app.mjs (servidor do navegador). Sem dependências do Android, para ser testável em JUnit.
 */
public final class HlsRewriter {
    private static final Pattern URI_ATTR = Pattern.compile("URI=\"([^\"]+)\"");

    private HlsRewriter() {}

    /** Codifica como encodeURIComponent do JavaScript (espaço vira %20, não +). */
    public static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8").replace("+", "%20")
                .replace("%21", "!").replace("%27", "'").replace("%28", "(").replace("%29", ")").replace("%7E", "~");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    public static String proxify(String abs, String ua, String ref) {
        StringBuilder b = new StringBuilder("/proxy?u=").append(enc(abs));
        if (ua != null && !ua.isEmpty()) b.append("&ua=").append(enc(ua));
        if (ref != null && !ref.isEmpty()) b.append("&ref=").append(enc(ref));
        return b.toString();
    }

    static String resolve(String base, String rel) {
        try {
            return URI.create(base).resolve(rel.replace(" ", "%20")).toString();
        } catch (IllegalArgumentException e) {
            return rel;
        }
    }

    /** true quando o texto é uma playlist HLS (e não uma lista de canais M3U). */
    public static boolean isHls(String text) {
        return text.contains("#EXT-X-");
    }

    public static String rewrite(String text, String baseUrl, String ua, String ref) {
        String[] lines = text.split("\r?\n", -1);
        StringBuilder out = new StringBuilder(text.length() + lines.length * 48);
        for (int i = 0; i < lines.length; i++) {
            if (i > 0) out.append('\n');
            String line = lines[i];
            String t = line.trim();
            if (t.isEmpty()) {
                out.append(line);
            } else if (t.startsWith("#")) {
                Matcher m = URI_ATTR.matcher(line);
                StringBuffer sb = new StringBuffer();
                while (m.find()) {
                    String repl = "URI=\"" + proxify(resolve(baseUrl, m.group(1)), ua, ref) + "\"";
                    m.appendReplacement(sb, Matcher.quoteReplacement(repl));
                }
                m.appendTail(sb);
                out.append(sb);
            } else {
                out.append(proxify(resolve(baseUrl, t), ua, ref));
            }
        }
        return out.toString();
    }
}
