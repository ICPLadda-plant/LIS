package com.icpladda.lis.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.IntentFilter;
import android.os.Build;
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
            "com.cxinventor.file.explorer",
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
    private TextView startupLabel;
    private View firstTile;
    private boolean resumed;

    /** ทีวี Xiaomi กด Power แล้วเข้าสแตนด์บาย ไม่ได้บูตใหม่ จึงต้องจับตอนจอเปิดกลับมาด้วย */
    private final BroadcastReceiver screenOn = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            // รอให้ระบบพาหน้า Home ขึ้นมาก่อน ถ้าตอนตื่นมีหน้าคิวหรือแอปอื่นค้างอยู่ด้านบนก็ไม่ไปแทรก
            handler.removeCallbacks(wakeCheck);
            handler.postDelayed(wakeCheck, 2500);
        }
    };

    private final Runnable wakeCheck = new Runnable() {
        @Override
        public void run() {
            if (!resumed) return;
            Startup.pending = true;
            runPendingStartup();
        }
    };

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            Date now = new Date();
            clock.setText(new SimpleDateFormat("HH:mm", thai).format(now));
            java.util.Calendar cal = java.util.Calendar.getInstance();
            int buddhistYear = cal.get(java.util.Calendar.YEAR) + 543;
            date.setText(new SimpleDateFormat("EEEEที่ d MMMM", thai).format(now) + " " + buddhistYear);
            network.setText("IP " + localIp());
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildLayout());
        firstTile.post(new Runnable() {
            @Override public void run() { firstTile.requestFocus(); }
        });
        IntentFilter filter = new IntentFilter(Intent.ACTION_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(screenOn, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(screenOn, filter);
        applyStartupExtra(getIntent());
        if (Startup.consumeNewBoot(this)) Startup.pending = true;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        applyStartupExtra(intent);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(wakeCheck);
        unregisterReceiver(screenOn);
        super.onDestroy();
    }

    /** ตั้งค่าผ่าน ADB ได้: am start -n com.icpladda.lis.tv/.MainActivity --es startup lab|qc|home */
    private void applyStartupExtra(Intent intent) {
        String mode = intent == null ? null : intent.getStringExtra("startup");
        if (mode != null && Startup.setMode(this, mode)) updateStartupLabel();
    }

    private void runPendingStartup() {
        if (!Startup.pending) return;
        Startup.pending = false;
        String mode = Startup.mode(this);
        if (!Startup.HOME.equals(mode)) openQueue(mode);
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        Ui.immersive(this);
        handler.removeCallbacks(tick);
        handler.post(tick);
        updateStartupLabel();
        runPendingStartup();
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
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
        int pad = Ui.dp(this, 40);
        root.setPadding(pad, Ui.dp(this, 28), pad, Ui.dp(this, 32));
        root.setClipChildren(false);
        root.setClipToPadding(false);

        root.addView(buildHeader(), new LinearLayout.LayoutParams(-1, -2));

        TextView section = label("เลือกจอคิว", 16, Ui.TEXT_MUTED, false);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-2, -2);
        sp.topMargin = Ui.dp(this, 20);
        sp.bottomMargin = Ui.dp(this, 10);
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

        TextView tools = label("เครื่องมือ", 16, Ui.TEXT_MUTED, false);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-2, -2);
        tp.topMargin = Ui.dp(this, 20);
        tp.bottomMargin = Ui.dp(this, 10);
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
        LinearLayout startupTile = (LinearLayout) smallTile("", R.drawable.ic_power, new View.OnClickListener() {
            @Override public void onClick(View v) { chooseStartup(); }
        });
        startupLabel = (TextView) startupTile.getChildAt(1);
        startupLabel.setTextSize(16);
        small.addView(startupTile, weighted(12, 12));
        small.addView(smallTile("ตั้งค่า", R.drawable.ic_settings, new View.OnClickListener() {
            @Override public void onClick(View v) { openSettings(); }
        }), weighted(12, 0));
        root.addView(small, new LinearLayout.LayoutParams(-1, Ui.dp(this, 72)));
        return root;
    }

    private View buildHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.icon);
        header.addView(logo, new LinearLayout.LayoutParams(Ui.dp(this, 48), Ui.dp(this, 48)));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(Ui.dp(this, 14), 0, 0, 0);
        titles.addView(label("ICP Ladda LIS", 22, Ui.TEXT, true));
        network = label("", 13, Ui.TEXT_MUTED, false);
        titles.addView(network);
        header.addView(titles, new LinearLayout.LayoutParams(0, -2, 1f));

        LinearLayout time = new LinearLayout(this);
        time.setOrientation(LinearLayout.VERTICAL);
        time.setGravity(Gravity.END);
        clock = label("", 34, Ui.TEXT, true);
        clock.setGravity(Gravity.END);
        date = label("", 14, Ui.TEXT_MUTED, false);
        date.setGravity(Gravity.END);
        time.addView(clock);
        time.addView(date);
        header.addView(time);
        return header;
    }

    private View bigTile(String title, String subtitle, int icon, int accent, View.OnClickListener click) {
        LinearLayout tile = new LinearLayout(this);
        tile.setOrientation(LinearLayout.HORIZONTAL);
        tile.setGravity(Gravity.CENTER_VERTICAL);
        int p = Ui.dp(this, 28);
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

        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        texts.setPadding(Ui.dp(this, 24), 0, 0, 0);
        texts.addView(label(title, 36, Ui.TEXT, true));
        TextView sub = label(subtitle, 16, 0xDDFFFFFF, false);
        sub.setPadding(0, Ui.dp(this, 4), 0, 0);
        texts.addView(sub);
        tile.addView(texts, new LinearLayout.LayoutParams(0, -2, 1f));
        return tile;
    }

    private View smallTile(String title, int icon, View.OnClickListener click) {
        LinearLayout tile = new LinearLayout(this);
        tile.setOrientation(LinearLayout.HORIZONTAL);
        tile.setGravity(Gravity.CENTER);
        GradientDrawable bg = Ui.rounded(this, Ui.CARD, 16);
        tile.setBackground(bg);
        Ui.focusEffect(tile, bg, Ui.PRIMARY);
        tile.setOnClickListener(click);

        ImageView iv = new ImageView(this);
        iv.setImageResource(icon);
        tile.addView(iv, new LinearLayout.LayoutParams(Ui.dp(this, 30), Ui.dp(this, 30)));
        TextView t = label(title, 18, Ui.TEXT, true);
        t.setPadding(Ui.dp(this, 12), 0, 0, 0);
        tile.addView(t, new LinearLayout.LayoutParams(-2, -2));
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

    private void updateStartupLabel() {
        if (startupLabel != null) startupLabel.setText("เปิดเครื่อง: " + Startup.label(Startup.mode(this)).replace("คิว ", ""));
    }

    private void chooseStartup() {
        final String[] modes = Startup.MODES;
        String[] labels = new String[modes.length];
        int checked = 0;
        String current = Startup.mode(this);
        for (int i = 0; i < modes.length; i++) {
            labels[i] = Startup.label(modes[i]) + (Startup.QC.equals(modes[i]) ? " (ค่าเริ่มต้น)" : "");
            if (modes[i].equals(current)) checked = i;
        }
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("เปิดเครื่องแล้วให้แสดงหน้าไหน")
                .setSingleChoiceItems(labels, checked, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        Startup.setMode(MainActivity.this, modes[which]);
                        updateStartupLabel();
                        dialog.dismiss();
                    }
                })
                .setNegativeButton("ยกเลิก", null)
                .show();
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
