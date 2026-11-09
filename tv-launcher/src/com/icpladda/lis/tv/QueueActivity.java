package com.icpladda.lis.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

/** เปิดหน้าคิว LIS เต็มจอ เปิดค้างได้ทั้งวัน และโหลดใหม่เองเมื่อเชื่อมต่อไม่ได้ */
public class QueueActivity extends Activity {
    static final String EXTRA_MODE = "mode";
    private static final long RETRY_MS = 10_000;
    /** ให้หน้าเว็บจัด layout ตามความกว้างจอ Full HD แทนขนาด dp ของทีวี (ปกติ 960) */
    private static final String FIT_TV_JS =
            "(function(){var m=document.querySelector('meta[name=viewport]');"
            + "if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}"
            + "var w=Math.max(screen.width*window.devicePixelRatio,1280);"
            + "if(m.content!=='width='+w){m.content='width='+w;}})();";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private TextView overlay;
    private String mode;
    private boolean failed;

    private final Runnable retry = new Runnable() {
        @Override
        public void run() {
            failed = false;
            web.reload();
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        mode = "qc".equals(getIntent().getStringExtra(EXTRA_MODE)) ? "qc" : "lab";

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= 21) s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(FIT_TV_JS, null);
                if (!failed) overlay.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showError();
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int code, String desc, String url) {
                showError();
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        overlay = new TextView(this);
        overlay.setText("กำลังเปิดคิว " + ("qc".equals(mode) ? "QC" : "Lab") + "…");
        overlay.setTextSize(28);
        overlay.setTextColor(Color.WHITE);
        overlay.setGravity(Gravity.CENTER);
        overlay.setBackground(Ui.background());
        root.addView(overlay, new FrameLayout.LayoutParams(-1, -1));

        setContentView(root);
        web.loadUrl(MainActivity.BASE_URL + "/queue/" + mode);
    }

    private void showError() {
        failed = true;
        overlay.setText("เชื่อมต่อหน้าคิวไม่ได้\nกำลังลองใหม่อัตโนมัติ… (กด OK เพื่อลองทันที)");
        overlay.setVisibility(View.VISIBLE);
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, RETRY_MS);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Ui.immersive(this);
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(retry);
        web.destroy();
        super.onDestroy();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // ดักปุ่มรีโมทก่อนส่งให้หน้าเว็บ เพื่อให้สลับคิว/กลับหน้า Home ได้เสมอ
        int keyCode = event.getKeyCode();
        boolean handled = keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
                || keyCode == KeyEvent.KEYCODE_BACK
                || (failed && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER));
        if (!handled) return super.dispatchKeyEvent(event);
        if (event.getAction() != KeyEvent.ACTION_DOWN || event.getRepeatCount() > 0) return true;
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                handler.removeCallbacks(retry);
                retry.run();
                return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                // สลับระหว่างคิว Lab และ QC ด้วยปุ่มซ้าย/ขวา
                mode = "qc".equals(mode) ? "lab" : "qc";
                failed = false;
                overlay.setText("กำลังเปิดคิว " + ("qc".equals(mode) ? "QC" : "Lab") + "…");
                overlay.setVisibility(View.VISIBLE);
                web.loadUrl(MainActivity.BASE_URL + "/queue/" + mode);
                return true;
            case KeyEvent.KEYCODE_BACK:
                finish();
                return true;
            default:
                return true;
        }
    }
}
