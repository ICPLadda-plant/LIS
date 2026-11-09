package com.icpladda.lis.tv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.text.SimpleDateFormat;
import java.util.Collections;
import java.util.Date;
import java.util.Locale;

/** หน้า Home ของทีวี: เปิดคิว Lab/QC, ไฟล์, แอปทั้งหมด และตั้งค่า */
public class MainActivity extends Activity {
    static final String BASE_URL = "https://app-plant.icpladda.com/LIS";

    /** แอปจัดการไฟล์ที่ลองเปิดตามลำดับ (Xiaomi / Google TV / Android ทั่วไป) */
    private static final String[] FILE_APPS = {
            "com.xiaomi.mitv.mediaexplorer",
            "com.mitv.mediaexplorer",
            "com.xiaomi.mitv.filemanager",
            "com.estrongs.android.pop",
            "com.alphainventor.filemanager",
            "com.google.android.documentsui",
            "com.android.documentsui",
    };

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Locale thai = new Locale("th", "TH");
    private TextView clock;
    private TextView date;
    private TextView network;
    private View firstTile;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            Date now = new Date();
            clock.setText(new SimpleDateFormat("HH:mm", thai).format(now));
            date.setText(new SimpleDateFormat("EEEEที่ d MMMM yyyy", thai).format(now));
            network.setText("IP " + localIp());
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildLayout());
        firstTile.requestFocus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        Ui.immersive(this);
        handler.removeCallbacks(tick);
        handler.post(tick);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(tick);
    }

    @Override
    public void onBackPressed() {
        // เป็นหน้า Home แล้ว กด Back ไม่ต้องออก
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) {
            openSettings();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private View buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackground(Ui.background());
        int pad = Ui.dp(this, 48);
        root.setPadding(pad, Ui.dp(this, 32), pad, Ui.dp(this, 32));
        root.setClipChildren(false);
        root.setClipToPadding(false);

        root.addView(buildHeader(), new LinearLayout.LayoutParams(-1, -2));

        TextView section = label("เลือกจอคิว", 20, Ui.TEXT_MUTED, false);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-2, -2);
        sp.topMargin = Ui.dp(this, 28);
        sp.bottomMargin = Ui.dp(this, 12);
        root.addView(section, sp);

        LinearLayout big = row();
        View lab = bigTile("คิว Lab", "ติดตามงานวิเคราะห์ห้องปฏิบัติการ", R.drawable.ic_flask, Ui.LAB,
                new View.OnClickListener() {
                    @Override public void onClick(View v) { openQueue("lab"); }
                });
        View qc = bigTile("คิว QC", "ติดตามงานตรวจคุณภาพ QC", R.drawable.ic_shield, Ui.QC,
                new View.OnClickListener() {
                    @Override public void onClick(View v) { openQueue("qc"); }
                });
        firstTile = lab;
        big.addView(lab, weighted(0, 16));
        big.addView(qc, weighted(16, 0));
        root.addView(big, new LinearLayout.LayoutParams(-1, 0, 3f));

        TextView tools = label("เครื่องมือ", 20, Ui.TEXT_MUTED, false);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-2, -2);
        tp.topMargin = Ui.dp(this, 28);
        tp.bottomMargin = Ui.dp(this, 12);
        root.addView(tools, tp);

        LinearLayout small = row();
        small.addView(smallTile("ไฟล์", R.drawable.ic_folder, new View.OnClickListener() {
            @Override public void onClick(View v) { openFiles(); }
        }), weighted(0, 12));
        small.addView(smallTile("แอปทั้งหมด", R.drawable.ic_apps, new View.OnClickListener() {
            @Override public void onClick(View v) { startActivity(new Intent(MainActivity.this, AppsActivity.class)); }
        }), weighted(12, 12));
        small.addView(smallTile("เครือข่าย", R.drawable.ic_wifi, new View.OnClickListener() {
            @Override public void onClick(View v) { openNetwork(); }
        }), weighted(12, 12));
        small.addView(smallTile("ตั้งค่า", R.drawable.ic_settings, new View.OnClickListener() {
            @Override public void onClick(View v) { openSettings(); }
        }), weighted(12, 0));
        root.addView(small, new LinearLayout.LayoutParams(-1, 0, 1.3f));
        return root;
    }

    private View buildHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.icon);
        header.addView(logo, new LinearLayout.LayoutParams(Ui.dp(this, 56), Ui.dp(this, 56)));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(Ui.dp(this, 16), 0, 0, 0);
        titles.addView(label("ICP Ladda LIS", 28, Ui.TEXT, true));
        network = label("", 15, Ui.TEXT_MUTED, false);
        titles.addView(network);
        header.addView(titles, new LinearLayout.LayoutParams(0, -2, 1f));

        LinearLayout time = new LinearLayout(this);
        time.setOrientation(LinearLayout.VERTICAL);
        time.setGravity(Gravity.END);
        clock = label("", 44, Ui.TEXT, true);
        clock.setGravity(Gravity.END);
        date = label("", 17, Ui.TEXT_MUTED, false);
        date.setGravity(Gravity.END);
        time.addView(clock);
        time.addView(date);
        header.addView(time);
        return header;
    }

    private View bigTile(String title, String subtitle, int icon, int accent, View.OnClickListener click) {
        LinearLayout tile = new LinearLayout(this);
        tile.setOrientation(LinearLayout.VERTICAL);
        tile.setGravity(Gravity.CENTER_VERTICAL);
        int p = Ui.dp(this, 32);
        tile.setPadding(p, p, p, p);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[] {accent, darker(accent)});
        bg.setCornerRadius(Ui.dp(this, 20));
        tile.setBackground(bg);
        Ui.focusEffect(tile, bg, accent);
        tile.setOnClickListener(click);

        ImageView iv = new ImageView(this);
        iv.setImageResource(icon);
        tile.addView(iv, new LinearLayout.LayoutParams(Ui.dp(this, 72), Ui.dp(this, 72)));
        TextView t = label(title, 44, Ui.TEXT, true);
        t.setPadding(0, Ui.dp(this, 16), 0, Ui.dp(this, 4));
        tile.addView(t);
        tile.addView(label(subtitle, 20, 0xDDFFFFFF, false));
        return tile;
    }

    private View smallTile(String title, int icon, View.OnClickListener click) {
        LinearLayout tile = new LinearLayout(this);
        tile.setOrientation(LinearLayout.VERTICAL);
        tile.setGravity(Gravity.CENTER);
        GradientDrawable bg = Ui.rounded(this, Ui.CARD, 16);
        tile.setBackground(bg);
        Ui.focusEffect(tile, bg, Ui.PRIMARY);
        tile.setOnClickListener(click);

        ImageView iv = new ImageView(this);
        iv.setImageResource(icon);
        tile.addView(iv, new LinearLayout.LayoutParams(Ui.dp(this, 44), Ui.dp(this, 44)));
        TextView t = label(title, 22, Ui.TEXT, true);
        t.setPadding(0, Ui.dp(this, 10), 0, 0);
        tile.addView(t);
        return tile;
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setClipChildren(false);
        r.setClipToPadding(false);
        return r;
    }

    private LinearLayout.LayoutParams weighted(int leftDp, int rightDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -1, 1f);
        lp.leftMargin = Ui.dp(this, leftDp / 2f);
        lp.rightMargin = Ui.dp(this, rightDp / 2f);
        return lp;
    }

    private TextView label(String text, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }

    private static int darker(int c) {
        float[] hsv = new float[3];
        android.graphics.Color.colorToHSV(c, hsv);
        hsv[2] *= 0.7f;
        return android.graphics.Color.HSVToColor(hsv);
    }

    private void openQueue(String mode) {
        Intent i = new Intent(this, QueueActivity.class);
        i.putExtra(QueueActivity.EXTRA_MODE, mode);
        startActivity(i);
    }

    private void openFiles() {
        PackageManager pm = getPackageManager();
        for (String pkg : FILE_APPS) {
            Intent launch = pm.getLeanbackLaunchIntentForPackage(pkg);
            if (launch == null) launch = pm.getLaunchIntentForPackage(pkg);
            if (launch != null && tryStart(launch)) return;
        }
        Intent docs = new Intent(Intent.ACTION_GET_CONTENT);
        docs.setType("*/*");
        docs.addCategory(Intent.CATEGORY_OPENABLE);
        if (tryStart(docs)) return;
        Toast.makeText(this, "ไม่พบแอปจัดการไฟล์ เลือกจากแอปทั้งหมดแทน", Toast.LENGTH_LONG).show();
        startActivity(new Intent(this, AppsActivity.class));
    }

    private void openNetwork() {
        if (!tryStart(new Intent(Settings.ACTION_WIFI_SETTINGS))) openSettings();
    }

    private void openSettings() {
        if (tryStart(new Intent(Settings.ACTION_SETTINGS))) return;
        Intent tv = getPackageManager().getLaunchIntentForPackage("com.android.tv.settings");
        if (tv == null || !tryStart(tv)) {
            Toast.makeText(this, "เปิดหน้าตั้งค่าไม่ได้", Toast.LENGTH_LONG).show();
        }
    }

    private boolean tryStart(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    private String localIp() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) {
        }
        return "ไม่ได้เชื่อมต่อเครือข่าย";
    }
}
