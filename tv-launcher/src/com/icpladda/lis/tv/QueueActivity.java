package com.icpladda.lis.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
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

import java.net.HttpURLConnection;
import java.net.URL;

/** เปิดหน้าคิว LIS เต็มจอ เปิดค้างได้ทั้งวัน และโหลดใหม่เองเมื่อเชื่อมต่อไม่ได้ */
public class QueueActivity extends Activity {
    static final String EXTRA_MODE = "mode";
    /** เปิดจากการเปิดเครื่อง/ตื่นจากสแตนด์บาย: แสดงหน้า loading อย่างน้อย STARTUP_DELAY_MS ก่อน */
    static final String EXTRA_STARTUP = "startup";
    private static final long RETRY_MS = 10_000;
    private static final long STARTUP_DELAY_MS = 10_000;
    /** รอเน็ตนานสุดเท่านี้ แล้วลองโหลดเลย (ถ้าไม่ได้จะเข้าโหมดลองใหม่ทุก 10 วิ) */
    private static final long MAX_WAIT_MS = 120_000;
    /** ถ้าจอดับ/ถูกซ่อนนานกว่านี้ ตอนกลับมาให้รอเน็ตแล้วโหลดหน้าใหม่ */
    private static final long RESUME_RELOAD_MS = 60_000;
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
    private boolean waiting;
    private boolean probing;
    private volatile boolean serverReachable;
    private long waitStartedAt;
    private long minDelayMs;
    private long stoppedAt;

    private final Runnable retry = new Runnable() {
        @Override
        public void run() {
            failed = false;
            web.reload();
        }
    };

    /** ทุก 1 วิ: นับถอยหลังขั้นต่ำ + เช็คว่าเข้าเซิร์ฟเวอร์ LIS ได้จริง แล้วค่อยโหลดหน้าคิว */
    private final Runnable waitTick = new Runnable() {
        @Override
        public void run() {
            if (!waiting) return;
            long elapsed = System.currentTimeMillis() - waitStartedAt;
            boolean delayDone = elapsed >= minDelayMs;
            if (delayDone && serverReachable || elapsed >= MAX_WAIT_MS) {
                waiting = false;
                showLoading("กำลังเปิดคิว " + modeLabel() + "…", null);
                web.loadUrl(queueUrl());
                return;
            }
            if (!probing && !serverReachable) probe();
            long remain = Math.max(0, (minDelayMs - elapsed + 999) / 1000);
            String status = serverReachable ? "เชื่อมต่อเครือข่ายแล้ว" : "กำลังรอเชื่อมต่อเครือข่าย…";
            showLoading("กำลังเริ่มระบบคิว " + modeLabel(), status + (remain > 0 ? "  (" + remain + ")" : ""));
            handler.postDelayed(this, 1000);
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
        overlay.setTextSize(28);
        overlay.setTextColor(Color.WHITE);
        overlay.setGravity(Gravity.CENTER);
        overlay.setLineSpacing(0, 1.3f);
        overlay.setBackground(Ui.background());
        root.addView(overlay, new FrameLayout.LayoutParams(-1, -1));

        setContentView(root);
        startWaiting(getIntent().getBooleanExtra(EXTRA_STARTUP, false));
    }

    private String modeLabel() { return "qc".equals(mode) ? "QC" : "Lab"; }

    private String queueUrl() { return MainActivity.BASE_URL + "/queue/" + mode; }

    private void showLoading(String title, String status) {
        overlay.setText(status == null ? title : title + "\n" + status);
        overlay.setVisibility(View.VISIBLE);
    }

    /** แสดงหน้า loading แล้วรอจนเน็ตพร้อม (และครบ 10 วิ ถ้าเป็นตอนเปิดเครื่อง) ก่อนโหลดหน้าคิว */
    private void startWaiting(boolean startup) {
        handler.removeCallbacks(retry);
        handler.removeCallbacks(waitTick);
        failed = false;
        waiting = true;
        serverReachable = false;
        minDelayMs = startup ? STARTUP_DELAY_MS : 0;
        waitStartedAt = System.currentTimeMillis();
        web.stopLoading();
        waitTick.run();
    }

    /** ลองเรียกเซิร์ฟเวอร์ LIS จริง (ไม่พึ่งการเช็คเน็ตของ Google ที่อาจถูกบล็อกในเครือข่ายบริษัท) */
    private void probe() {
        probing = true;
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean ok = false;
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(MainActivity.BASE_URL + "/").openConnection();
                    conn.setConnectTimeout(3000);
                    conn.setReadTimeout(3000);
                    conn.setRequestMethod("HEAD");
                    ok = conn.getResponseCode() > 0;
                } catch (Exception ignored) {
                } finally {
                    if (conn != null) conn.disconnect();
                }
                serverReachable = ok;
                probing = false;
            }
        }, "lis-probe").start();
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
        Startup.pending = false;
        Ui.immersive(this);
        web.onResume();
        // ตื่นจากสแตนด์บายด้วยรีโมทโดยหน้าคิวค้างอยู่: Wi-Fi อาจยังไม่กลับ ให้รอแล้วโหลดใหม่
        if (stoppedAt > 0 && System.currentTimeMillis() - stoppedAt > RESUME_RELOAD_MS) startWaiting(true);
        stoppedAt = 0;
    }

    @Override
    protected void onStop() {
        stoppedAt = System.currentTimeMillis();
        super.onStop();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String next = "qc".equals(intent.getStringExtra(EXTRA_MODE)) ? "qc" : "lab";
        boolean startup = intent.getBooleanExtra(EXTRA_STARTUP, false);
        if (next.equals(mode) && !startup) return;
        mode = next;
        startWaiting(startup);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(retry);
        handler.removeCallbacks(waitTick);
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
                startWaiting(false);
                return true;
            case KeyEvent.KEYCODE_BACK:
                finish();
                return true;
            default:
                return true;
        }
    }
}
