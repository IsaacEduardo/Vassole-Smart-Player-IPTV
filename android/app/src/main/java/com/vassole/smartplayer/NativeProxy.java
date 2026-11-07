package com.vassole.smartplayer;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Proxy do app dentro do APK: atende /proxy e /api/health da própria página (http://localhost),
 * como o server.mjs faz no navegador. Assim o app acessa provedores sem CORS, streams http,
 * guias grandes em fluxo e cabeçalhos por canal (User-Agent e Referer).
 *
 * Só responde a pedidos da página do app (o WebViewClient chama apenas para o host dela): nada
 * fica aberto em porta de rede. Endereços da rede local são permitidos (provedores na própria casa).
 */
final class NativeProxy {
    static final String DEFAULT_UA = "VassoleSmartPlayer/1.0";
    private static final int MAX_REDIRECTS = 5;
    private static final int MAX_PLAYLIST_BYTES = 64 * 1024 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 25000;
    private static final int READ_TIMEOUT_MS = 30000;

    private final String version;

    NativeProxy(String version) {
        this.version = version;
    }

    static boolean handles(Uri url) {
        String p = url.getPath();
        return "/proxy".equals(p) || "/api/health".equals(p);
    }

    WebResourceResponse handle(WebResourceRequest req) {
        Uri url = req.getUrl();
        if ("/api/health".equals(url.getPath())) {
            String body = "{\"ok\":true,\"app\":\"sintonia\",\"version\":\"" + version + "\",\"proxy\":true,\"native\":\"android\"}";
            return text(200, "OK", "application/json", body);
        }
        String method = req.getMethod();
        if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) return text(405, "Method Not Allowed", "text/plain", "");
        String raw = url.getQueryParameter("u");
        String ua = trim(url.getQueryParameter("ua"), 512);
        String ref = trim(url.getQueryParameter("ref"), 2048);
        if (ref != null && !ref.matches("(?i)^https?://.+")) ref = null;
        if (raw == null || !raw.matches("(?i)^https?://.+")) return text(400, "Bad Request", "text/plain", "URL inválida");

        String range = header(req.getRequestHeaders(), "Range");
        HttpURLConnection conn = null;
        try {
            String current = raw;
            int status = 0;
            for (int hop = 0; ; hop++) {
                conn = (HttpURLConnection) new URL(current).openConnection();
                conn.setInstanceFollowRedirects(false); // segue à mão: o Java não troca de http para https sozinho
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setRequestMethod("HEAD".equalsIgnoreCase(method) ? "HEAD" : "GET");
                conn.setRequestProperty("User-Agent", ua != null && !ua.isEmpty() ? ua : DEFAULT_UA);
                conn.setRequestProperty("Accept", "*/*");
                if (ref != null) conn.setRequestProperty("Referer", ref);
                if (range != null) conn.setRequestProperty("Range", range);
                status = conn.getResponseCode();
                String loc = conn.getHeaderField("Location");
                if (status >= 300 && status < 400 && status != 304 && loc != null) {
                    if (hop >= MAX_REDIRECTS) return text(502, "Bad Gateway", "text/plain", "Redirecionamentos demais");
                    String next = new URL(new URL(current), loc).toString();
                    if (!next.matches("(?i)^https?://.+")) return text(502, "Bad Gateway", "text/plain", "Redirecionamento inválido");
                    conn.disconnect();
                    current = next;
                    continue;
                }
                break;
            }

            String ct = conn.getContentType() != null ? conn.getContentType() : "";
            String mime = ct.split(";")[0].trim();
            Map<String, String> out = new HashMap<>();
            out.put("Cache-Control", "no-store");
            out.put("X-Final-Url", current);
            copy(conn, out, "Content-Range");
            copy(conn, out, "Accept-Ranges");
            copy(conn, out, "Last-Modified");
            copy(conn, out, "ETag");
            int code = safeStatus(status);
            String reason = conn.getResponseMessage() != null && !conn.getResponseMessage().isEmpty() ? conn.getResponseMessage() : "OK";
            InputStream body = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (body == null) body = new ByteArrayInputStream(new byte[0]);

            String path = new URL(current).getPath().toLowerCase(Locale.ROOT);
            boolean maybePlaylist = ct.toLowerCase(Locale.ROOT).contains("mpegurl") || path.endsWith(".m3u8") || path.endsWith(".m3u");
            if (maybePlaylist && !"HEAD".equalsIgnoreCase(method) && conn.getContentLength() < MAX_PLAYLIST_BYTES) {
                String textBody = readAll(body);
                conn.disconnect();
                String result = HlsRewriter.isHls(textBody) ? HlsRewriter.rewrite(textBody, current, ua, ref) : textBody;
                byte[] bytes = result.getBytes(StandardCharsets.UTF_8);
                out.put("Content-Length", String.valueOf(bytes.length));
                return new WebResourceResponse(mime.isEmpty() ? "application/vnd.apple.mpegurl" : mime, "utf-8", code, reason, out, new ByteArrayInputStream(bytes));
            }
            // O HttpURLConnection já descompacta gzip: o corpo segue sem Content-Encoding.
            if (conn.getHeaderField("Content-Encoding") == null && conn.getContentLength() >= 0) {
                out.put("Content-Length", String.valueOf(conn.getContentLength()));
            }
            String charset = charsetOf(ct);
            return new WebResourceResponse(mime.isEmpty() ? "application/octet-stream" : mime, charset, code, reason, out, body);
        } catch (IOException e) {
            if (conn != null) conn.disconnect();
            String msg = e.getClass().getSimpleName();
            return text(502, "Bad Gateway", "text/plain", "Falha ao acessar a origem: " + msg);
        }
    }

    // WebResourceResponse não aceita 3xx; um 304 ou 3xx sem Location vira 502.
    private static int safeStatus(int s) {
        return (s >= 100 && s < 300) || (s >= 400 && s < 600) ? s : 502;
    }

    private static String charsetOf(String ct) {
        for (String part : ct.split(";")) {
            String p = part.trim();
            if (p.toLowerCase(Locale.ROOT).startsWith("charset=")) return p.substring(8).replace("\"", "");
        }
        return null;
    }

    private static void copy(HttpURLConnection c, Map<String, String> out, String name) {
        String v = c.getHeaderField(name);
        if (v != null) out.put(name, v);
    }

    private static String header(Map<String, String> h, String name) {
        if (h == null) return null;
        for (Map.Entry<String, String> e : h.entrySet()) if (e.getKey().equalsIgnoreCase(name)) return e.getValue();
        return null;
    }

    private static String trim(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[64 * 1024];
        int n;
        int total = 0;
        try (InputStream s = in) {
            while ((n = s.read(chunk)) > 0) {
                total += n;
                if (total > MAX_PLAYLIST_BYTES) throw new IOException("Playlist grande demais");
                buf.write(chunk, 0, n);
            }
        }
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }

    private static WebResourceResponse text(int code, String reason, String mime, String body) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        return new WebResourceResponse(mime, "utf-8", code, reason, h, new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }
}
