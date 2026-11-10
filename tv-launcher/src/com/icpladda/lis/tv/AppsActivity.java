package com.icpladda.lis.tv;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** รายการแอปทั้งหมดในทีวี ใช้เปิดแอปอื่นที่ไม่ได้อยู่บนหน้า Home */
public class AppsActivity extends Activity {
    private static final class App {
        final String label;
        final ComponentName component;
        final Drawable icon;
        App(String label, ComponentName component, Drawable icon) {
            this.label = label; this.component = component; this.icon = icon;
        }
    }

    private final List<App> apps = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        loadApps();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackground(Ui.background());
        int pad = Ui.dp(this, 48);
        root.setPadding(pad, Ui.dp(this, 32), pad, 0);

        TextView title = new TextView(this);
        title.setText("แอปทั้งหมด");
        title.setTextSize(30);
        title.setTextColor(Ui.TEXT);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        root.addView(title);

        GridView grid = new GridView(this);
        grid.setNumColumns(6);
        grid.setVerticalSpacing(Ui.dp(this, 16));
        grid.setHorizontalSpacing(Ui.dp(this, 16));
        grid.setPadding(0, Ui.dp(this, 24), 0, Ui.dp(this, 24));
        grid.setClipToPadding(false);
        grid.setSelector(Ui.rounded(this, 0x00000000, 16));
        grid.setDrawSelectorOnTop(false);
        grid.setAdapter(new Adapter());
        grid.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                Intent i = new Intent(Intent.ACTION_MAIN);
                i.setComponent(apps.get(position).component);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { startActivity(i); } catch (Exception ignored) { }
            }
        });
        grid.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            View last;
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                highlight(last, false);
                highlight(view, true);
                last = view;
            }
            @Override
            public void onNothingSelected(AdapterView<?> parent) {
                highlight(last, false);
                last = null;
            }
        });
        root.addView(grid, new LinearLayout.LayoutParams(-1, 0, 1f));
        setContentView(root);
        grid.requestFocus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        Ui.immersive(this);
    }

    private void highlight(View v, boolean on) {
        if (v == null) return;
        GradientDrawable bg = (GradientDrawable) v.getBackground();
        bg.setColor(on ? Ui.CARD_FOCUS : Ui.CARD);
        bg.setStroke(on ? Ui.dp(this, 3) : 0, on ? 0xFFFFFFFF : 0);
        float s = on ? 1.06f : 1f;
        v.animate().scaleX(s).scaleY(s).setDuration(150).start();
    }

    private void loadApps() {
        PackageManager pm = getPackageManager();
        Map<String, App> byPackage = new LinkedHashMap<>();
        for (String category : new String[] {Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER}) {
            Intent q = new Intent(Intent.ACTION_MAIN);
            q.addCategory(category);
            for (ResolveInfo ri : pm.queryIntentActivities(q, 0)) {
                String pkg = ri.activityInfo.packageName;
                if (pkg.equals(getPackageName()) || byPackage.containsKey(pkg)) continue;
                byPackage.put(pkg, new App(String.valueOf(ri.loadLabel(pm)),
                        new ComponentName(pkg, ri.activityInfo.name), ri.loadIcon(pm)));
            }
        }
        apps.addAll(byPackage.values());
        Collections.sort(apps, new Comparator<App>() {
            @Override public int compare(App a, App b) { return a.label.compareToIgnoreCase(b.label); }
        });
    }

    private final class Adapter extends BaseAdapter {
        @Override public int getCount() { return apps.size(); }
        @Override public Object getItem(int p) { return apps.get(p); }
        @Override public long getItemId(int p) { return p; }

        @Override
        public View getView(int position, View convert, ViewGroup parent) {
            LinearLayout cell = new LinearLayout(AppsActivity.this);
            cell.setOrientation(LinearLayout.VERTICAL);
            cell.setGravity(Gravity.CENTER);
            int p = Ui.dp(AppsActivity.this, 12);
            cell.setPadding(p, p, p, p);
            cell.setBackground(Ui.rounded(AppsActivity.this, Ui.CARD, 16));
            cell.setMinimumHeight(Ui.dp(AppsActivity.this, 140));

            App app = apps.get(position);
            ImageView iv = new ImageView(AppsActivity.this);
            iv.setImageDrawable(app.icon);
            int s = Ui.dp(AppsActivity.this, 64);
            cell.addView(iv, new LinearLayout.LayoutParams(s, s));

            TextView t = new TextView(AppsActivity.this);
            t.setText(app.label);
            t.setTextColor(Ui.TEXT);
            t.setTextSize(16);
            t.setGravity(Gravity.CENTER);
            t.setMaxLines(2);
            t.setEllipsize(TextUtils.TruncateAt.END);
            t.setPadding(0, Ui.dp(AppsActivity.this, 8), 0, 0);
            cell.addView(t);
            return cell;
        }
    }
}
