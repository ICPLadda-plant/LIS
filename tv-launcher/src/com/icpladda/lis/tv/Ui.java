package com.icpladda.lis.tv;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.view.View;
import android.view.Window;

/** สีและ helper ร่วมของแอป ใช้โทนเดียวกับ LIS (primary hsl(210 70% 45%)) */
final class Ui {
    static final int BG_TOP = Color.parseColor("#0B1B2E");
    static final int BG_BOTTOM = Color.parseColor("#12304F");
    static final int PRIMARY = Color.parseColor("#2273C3");
    static final int LAB = Color.parseColor("#2273C3");
    static final int QC = Color.parseColor("#16A34A");
    static final int CARD = Color.parseColor("#1A3554");
    static final int CARD_FOCUS = Color.parseColor("#24507D");
    static final int TEXT = Color.WHITE;
    static final int TEXT_MUTED = Color.parseColor("#A9BCD3");

    private Ui() {}

    static int dp(Context c, float v) {
        return Math.round(v * c.getResources().getDisplayMetrics().density);
    }

    static GradientDrawable rounded(Context c, int color, float radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(c, radiusDp));
        return d;
    }

    static GradientDrawable background() {
        return new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[] {BG_TOP, BG_BOTTOM});
    }

    /** ซ่อน status/navigation bar ให้เต็มจอ */
    static void immersive(Activity a) {
        Window w = a.getWindow();
        w.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        if (Build.VERSION.SDK_INT >= 21) {
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
        }
    }

    /** ขยายและเน้นขอบเมื่อรีโมทเลื่อนมาโฟกัส */
    static void focusEffect(final View v, final GradientDrawable bg, final int accent) {
        v.setFocusable(true);
        v.setFocusableInTouchMode(true);
        v.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override
            public void onFocusChange(View view, boolean hasFocus) {
                float s = hasFocus ? 1.06f : 1f;
                view.animate().scaleX(s).scaleY(s).setDuration(150).start();
                bg.setStroke(hasFocus ? dp(view.getContext(), 3) : 0, hasFocus ? Color.WHITE : Color.TRANSPARENT);
                if (Build.VERSION.SDK_INT >= 21) view.setElevation(hasFocus ? dp(view.getContext(), 12) : 0);
            }
        });
    }
}
