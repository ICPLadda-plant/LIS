package com.icpladda.lis.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;

/** ค่าตั้งของเครื่อง: เปิดเครื่องแล้วให้ไปหน้าไหน (ค่าเริ่มต้น = คิว QC) */
final class Startup {
    static final String QC = "qc";
    static final String LAB = "lab";
    static final String HOME = "home";
    static final String[] MODES = {QC, LAB, HOME};

    /** มีงานรอเปิดหน้าคิวหลังเปิดเครื่อง/ตื่นจากสแตนด์บาย */
    static boolean pending;

    private static final String PREFS = "lis_home";
    private static final String KEY_MODE = "startup_mode";
    private static final String KEY_BOOT = "last_boot_count";

    private Startup() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String mode(Context c) {
        String m = prefs(c).getString(KEY_MODE, QC);
        return LAB.equals(m) || HOME.equals(m) ? m : QC;
    }

    static boolean setMode(Context c, String mode) {
        for (String m : MODES) {
            if (m.equals(mode)) {
                prefs(c).edit().putString(KEY_MODE, m).apply();
                return true;
            }
        }
        return false;
    }

    static String label(String mode) {
        if (LAB.equals(mode)) return "คิว Lab";
        if (HOME.equals(mode)) return "หน้า Home";
        return "คิว QC";
    }

    /** true ครั้งแรกที่ถูกเรียกหลังบูตเครื่องแต่ละรอบ */
    static boolean consumeNewBoot(Context c) {
        int boot = Settings.Global.getInt(c.getContentResolver(), Settings.Global.BOOT_COUNT, -1);
        if (boot < 0 || prefs(c).getInt(KEY_BOOT, -1) == boot) return false;
        prefs(c).edit().putInt(KEY_BOOT, boot).apply();
        return true;
    }
}
