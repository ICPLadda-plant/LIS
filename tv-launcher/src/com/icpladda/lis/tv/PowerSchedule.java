package com.icpladda.lis.tv;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Calendar;
import java.util.Locale;

/** ตั้งเวลาเปิด/ปิดจอทีวีอัตโนมัติทุกวัน (ค่าเริ่มต้น เปิด 08:00 ปิด 17:00) */
final class PowerSchedule {
    static final String ACTION_ON = "com.icpladda.lis.tv.POWER_ON";
    static final String ACTION_OFF = "com.icpladda.lis.tv.POWER_OFF";

    private static final String PREFS = "lis_home";
    private static final String KEY_ENABLED = "power_schedule";
    private static final String KEY_ON = "power_on_min";
    private static final String KEY_OFF = "power_off_min";
    static final int DEFAULT_ON = 8 * 60;
    static final int DEFAULT_OFF = 17 * 60;

    private PowerSchedule() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean enabled(Context c) { return prefs(c).getBoolean(KEY_ENABLED, true); }
    static int onMinutes(Context c) { return prefs(c).getInt(KEY_ON, DEFAULT_ON); }
    static int offMinutes(Context c) { return prefs(c).getInt(KEY_OFF, DEFAULT_OFF); }

    static void setEnabled(Context c, boolean on) { prefs(c).edit().putBoolean(KEY_ENABLED, on).apply(); schedule(c); }
    static void setOn(Context c, int min) { prefs(c).edit().putInt(KEY_ON, min).apply(); schedule(c); }
    static void setOff(Context c, int min) { prefs(c).edit().putInt(KEY_OFF, min).apply(); schedule(c); }

    static String format(int min) {
        return String.format(Locale.US, "%02d:%02d", min / 60, min % 60);
    }

    /** แปลง "8:00" / "08:00" เป็นนาทีของวัน, -1 ถ้ารูปแบบไม่ถูก */
    static int parse(String hhmm) {
        if (hhmm == null) return -1;
        String[] p = hhmm.trim().split("[:.]");
        try {
            int h = Integer.parseInt(p[0]);
            int m = p.length > 1 ? Integer.parseInt(p[1]) : 0;
            return h >= 0 && h < 24 && m >= 0 && m < 60 ? h * 60 + m : -1;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** ตั้ง alarm รอบถัดไปของทั้งเวลาเปิดและปิด เรียกซ้ำได้เสมอ */
    static void schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent on = pending(c, ACTION_ON, 1);
        PendingIntent off = pending(c, ACTION_OFF, 2);
        am.cancel(on);
        am.cancel(off);
        if (!enabled(c)) return;
        set(am, nextAt(onMinutes(c)), on);
        set(am, nextAt(offMinutes(c)), off);
    }

    private static void set(AlarmManager am, long at, PendingIntent pi) {
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        if (exact && Build.VERSION.SDK_INT >= 23) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
    }

    private static PendingIntent pending(Context c, String action, int code) {
        Intent i = new Intent(c, PowerReceiver.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(c, code, i, flags);
    }

    static long nextAt(int minuteOfDay) {
        Calendar cal = Calendar.getInstance();
        long now = cal.getTimeInMillis();
        cal.set(Calendar.HOUR_OF_DAY, minuteOfDay / 60);
        cal.set(Calendar.MINUTE, minuteOfDay % 60);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        if (cal.getTimeInMillis() <= now + 1000) cal.add(Calendar.DAY_OF_MONTH, 1);
        return cal.getTimeInMillis();
    }
}
