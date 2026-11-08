package com.vassole.smartplayer;

import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.text.Cue;
import androidx.media3.common.text.CueGroup;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Map;

/**
 * Player nativo (Media3/ExoPlayer): HLS, MPEG-TS e arquivos (MP4/MKV) com decodificação por
 * hardware (HEVC, AC-3 quando o aparelho suporta), cabeçalhos por canal, faixas e legendas.
 * O vídeo é desenhado num SurfaceView atrás do WebView, no retângulo que a página informar
 * (setRect); a interface do app fica por cima. Eventos para a página: "state" (tempo, duração,
 * pausa, espera), "ended", "error", "tracks", "cues" (legendas do stream).
 */
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {
    private ExoPlayer player;
    private FrameLayout layer;
    private SurfaceView surface;
    private final Handler main = new Handler(Looper.getMainLooper());
    private int rx, ry, rw, rh;
    private boolean visible;
    private String aspect = "contain";
    private VideoSize videoSize = VideoSize.UNKNOWN;
    private Tracks lastTracks = Tracks.EMPTY;

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (player == null) return;
            emitState();
            main.postDelayed(this, 250);
        }
    };

    // ---- Montagem ----
    private void ensurePlayer() {
        if (player != null) return;
        WebView web = getBridge().getWebView();
        ViewGroup root = (ViewGroup) web.getParent();
        layer = new FrameLayout(getContext());
        layer.setBackgroundColor(Color.TRANSPARENT);
        surface = new SurfaceView(getContext());
        layer.addView(surface, new FrameLayout.LayoutParams(1, 1));
        root.addView(layer, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        surface.setVisibility(View.INVISIBLE);

        player = new ExoPlayer.Builder(getContext()).build();
        player.setVideoSurfaceView(surface);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) notifyListeners("ended", new JSObject());
                emitState();
            }
            @Override public void onIsPlayingChanged(boolean isPlaying) { emitState(); }
            @Override public void onPlayerError(@NonNull PlaybackException e) {
                if (e.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                    player.seekToDefaultPosition();
                    player.prepare();
                    return;
                }
                JSObject o = new JSObject();
                o.put("code", e.errorCode);
                o.put("name", e.getErrorCodeName());
                o.put("category", category(e.errorCode));
                o.put("message", e.getMessage() != null ? e.getMessage() : e.getErrorCodeName());
                notifyListeners("error", o);
            }
            @Override public void onVideoSizeChanged(@NonNull VideoSize size) { videoSize = size; layout(); }
            @Override public void onTracksChanged(@NonNull Tracks tracks) { lastTracks = tracks; notifyListeners("tracks", tracksJson(tracks, videoAuto())); }
            @Override public void onCues(@NonNull CueGroup group) {
                JSArray texts = new JSArray();
                for (Cue c : group.cues) if (c.text != null && c.text.length() > 0) texts.put(c.text.toString());
                JSObject o = new JSObject();
                o.put("texts", texts);
                notifyListeners("cues", o);
            }
        });
    }

    private static String category(int code) {
        if (code >= 2000 && code < 3000) return "network";  // IO: conexão, HTTP, tempo esgotado
        if (code >= 3000 && code < 4000) return "source";   // formato/parsing do stream
        if (code >= 4000 && code < 5000) return "decoder";  // codec não suportado / falha do decodificador
        return "other";
    }

    // Posiciona o vídeo no retângulo da página, respeitando a proporção (ajustar/preencher/esticar).
    private void layout() {
        if (surface == null) return;
        if (!visible || rw <= 0 || rh <= 0) { surface.setVisibility(View.INVISIBLE); return; }
        int w = rw, h = rh;
        if (videoSize.width > 0 && videoSize.height > 0 && !"fill".equals(aspect)) {
            float va = videoSize.width * videoSize.pixelWidthHeightRatio / videoSize.height;
            float ra = (float) rw / rh;
            boolean wider = va > ra;
            if ("cover".equals(aspect) == wider) { h = rh; w = Math.round(rh * va); } else { w = rw; h = Math.round(rw / va); }
        }
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(w, h);
        lp.leftMargin = rx + (rw - w) / 2;
        lp.topMargin = ry + (rh - h) / 2;
        surface.setLayoutParams(lp);
        surface.setVisibility(View.VISIBLE);
    }

    private void emitState() {
        if (player == null) return;
        JSObject o = new JSObject();
        long d = player.getDuration();
        o.put("t", Math.max(0, player.getCurrentPosition()) / 1000.0);
        o.put("d", player.isCurrentMediaItemLive() || d == C.TIME_UNSET ? -1 : d / 1000.0);
        o.put("paused", !player.getPlayWhenReady());
        o.put("playing", player.isPlaying());
        o.put("buffering", player.getPlaybackState() == Player.STATE_BUFFERING);
        o.put("ready", player.getPlaybackState() == Player.STATE_READY);
        o.put("rate", player.getPlaybackParameters().speed);
        notifyListeners("state", o);
    }

    // Qualidade automática = nenhuma escolha manual de faixa de vídeo nos parâmetros de seleção.
    private boolean videoAuto() {
        for (TrackSelectionOverride o : player.getTrackSelectionParameters().overrides.values()) {
            if (o.getType() == C.TRACK_TYPE_VIDEO) return false;
        }
        return true;
    }

    private static JSObject tracksJson(Tracks tracks, boolean videoAuto) {
        JSArray audio = new JSArray(), text = new JSArray(), video = new JSArray();
        for (int g = 0; g < tracks.getGroups().size(); g++) {
            Tracks.Group grp = tracks.getGroups().get(g);
            int type = grp.getType();
            if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_TEXT && type != C.TRACK_TYPE_VIDEO) continue;
            for (int i = 0; i < grp.length; i++) {
                if (!grp.isTrackSupported(i)) continue;
                Format f = grp.getTrackFormat(i);
                JSObject o = new JSObject();
                o.put("g", g);
                o.put("i", i);
                o.put("lang", f.language != null ? f.language : "");
                o.put("name", f.label != null ? f.label : "");
                o.put("active", grp.isTrackSelected(i));
                if (type == C.TRACK_TYPE_VIDEO) {
                    o.put("height", f.height > 0 ? f.height : 0);
                    o.put("bitrate", f.bitrate > 0 ? f.bitrate : 0);
                    video.put(o);
                } else (type == C.TRACK_TYPE_AUDIO ? audio : text).put(o);
            }
        }
        JSObject out = new JSObject();
        out.put("audio", audio);
        out.put("text", text);
        out.put("video", video);
        out.put("videoAuto", videoAuto);
        return out;
    }

    private void onMain(PluginCall call, Runnable r) {
        main.post(() -> {
            try { r.run(); call.resolve(); } catch (Exception e) { call.reject(e.getMessage() != null ? e.getMessage() : e.toString()); }
        });
    }

    // ---- Métodos chamados pela página ----
    @PluginMethod
    public void load(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.matches("(?i)^https?://.+")) { call.reject("URL inválida"); return; }
        String mime = call.getString("kind", "");
        String ua = call.getString("ua", "");
        String ref = call.getString("ref", "");
        double startAt = call.getDouble("startAt", 0.0);
        onMain(call, () -> {
            ensurePlayer();
            Map<String, String> headers = new HashMap<>();
            if (ref != null && ref.matches("(?i)^https?://.+")) headers.put("Referer", ref);
            DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(ua != null && !ua.isEmpty() ? ua : NativeProxy.DEFAULT_UA)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(25000)
                .setReadTimeoutMs(30000)
                .setDefaultRequestProperties(headers);
            MediaItem.Builder item = new MediaItem.Builder().setUri(url);
            if ("hls".equals(mime)) item.setMimeType(MimeTypes.APPLICATION_M3U8);
            else if ("mpegts".equals(mime)) item.setMimeType(MimeTypes.VIDEO_MP2T);
            player.setMediaSource(new DefaultMediaSourceFactory(http).createMediaSource(item.build()));
            player.setPlaybackParameters(PlaybackParameters.DEFAULT);
            player.prepare();
            if (startAt > 0) player.seekTo(Math.round(startAt * 1000));
            player.setPlayWhenReady(true);
            main.removeCallbacks(ticker);
            main.post(ticker);
        });
    }

    @PluginMethod public void play(PluginCall call) { onMain(call, () -> { if (player != null) player.setPlayWhenReady(true); }); }
    @PluginMethod public void pause(PluginCall call) { onMain(call, () -> { if (player != null) player.setPlayWhenReady(false); }); }

    @PluginMethod
    public void seek(PluginCall call) {
        double t = call.getDouble("t", 0.0);
        onMain(call, () -> { if (player != null) player.seekTo(Math.max(0, Math.round(t * 1000))); });
    }

    @PluginMethod
    public void setRate(PluginCall call) {
        float r = call.getFloat("rate", 1f);
        onMain(call, () -> { if (player != null) player.setPlaybackSpeed(r); });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        onMain(call, () -> {
            main.removeCallbacks(ticker);
            if (player != null) { player.stop(); player.clearMediaItems(); }
            videoSize = VideoSize.UNKNOWN;
            visible = false;
            layout();
        });
    }

    /** Retângulo do vídeo em pixels do WebView (CSS px × devicePixelRatio). */
    @PluginMethod
    public void setRect(PluginCall call) {
        int x = call.getInt("x", 0), y = call.getInt("y", 0), w = call.getInt("w", 0), h = call.getInt("h", 0);
        boolean show = Boolean.TRUE.equals(call.getBoolean("visible", true));
        String mode = call.getString("aspect", aspect);
        onMain(call, () -> {
            ensurePlayer();
            WebView web = getBridge().getWebView();
            rx = x + web.getLeft(); ry = y + web.getTop(); rw = w; rh = h;
            visible = show;
            aspect = mode;
            layout();
        });
    }

    /** type: audio | text | video; com g/i escolhe a faixa; off desliga legendas; auto volta a qualidade automática. */
    @PluginMethod
    public void selectTrack(PluginCall call) {
        String type = call.getString("type", "");
        int g = call.getInt("g", -1), i = call.getInt("i", -1);
        boolean off = Boolean.TRUE.equals(call.getBoolean("off", false));
        boolean auto = Boolean.TRUE.equals(call.getBoolean("auto", false));
        onMain(call, () -> {
            if (player == null) return;
            int t = "audio".equals(type) ? C.TRACK_TYPE_AUDIO : "text".equals(type) ? C.TRACK_TYPE_TEXT : C.TRACK_TYPE_VIDEO;
            androidx.media3.common.TrackSelectionParameters.Builder b = player.getTrackSelectionParameters().buildUpon();
            if (off) {
                b.setTrackTypeDisabled(t, true);
            } else if (auto || g < 0) {
                b.clearOverridesOfType(t).setTrackTypeDisabled(t, false);
            } else if (g < lastTracks.getGroups().size()) {
                b.setTrackTypeDisabled(t, false)
                    .setOverrideForType(new TrackSelectionOverride(lastTracks.getGroups().get(g).getMediaTrackGroup(), i));
            }
            player.setTrackSelectionParameters(b.build());
            notifyListeners("tracks", tracksJson(player.getCurrentTracks(), videoAuto()));
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacks(ticker);
        if (player != null) { player.release(); player = null; }
    }
}
