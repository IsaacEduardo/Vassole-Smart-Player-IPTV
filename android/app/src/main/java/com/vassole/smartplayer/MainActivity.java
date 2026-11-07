package com.vassole.smartplayer;

import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // /proxy e /api/health atendidos dentro do APK (NativeProxy).
        bridge.setWebViewClient(new ProxyWebViewClient(bridge, versionName()));
        WebSettings ws = bridge.getWebView().getSettings();
        // Vídeo começa sem exigir toque (troca de canal pelo controle remoto).
        ws.setMediaPlaybackRequiresUserGesture(false);
        // Durante o uso do app a tela não apaga nem entra em proteção de tela da TV.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "?";
        }
    }
}
