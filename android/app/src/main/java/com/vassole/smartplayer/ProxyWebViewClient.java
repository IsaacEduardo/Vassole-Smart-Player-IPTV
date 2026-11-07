package com.vassole.smartplayer;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/** Encaminha /proxy e /api/health da página do app para o NativeProxy; o resto segue com o Capacitor. */
public class ProxyWebViewClient extends BridgeWebViewClient {
    private final NativeProxy proxy;
    private final String appHost;

    public ProxyWebViewClient(Bridge bridge, String version) {
        super(bridge);
        this.proxy = new NativeProxy(version);
        this.appHost = bridge.getHost(); // "localhost" (capacitor.config.json)
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (appHost != null && appHost.equalsIgnoreCase(url.getHost()) && NativeProxy.handles(url)) {
            return proxy.handle(request);
        }
        return super.shouldInterceptRequest(view, request);
    }
}
