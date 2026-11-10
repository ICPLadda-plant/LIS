package com.icpladda.lis.tv;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Calendar;
import java.util.Locale;

/**
 * ตั้งเวลาเปิด/ปิดจอทีวีอัตโนมัติ (ค่าเริ่มต้น เปิด 08:00 จันทร์–เสาร์ ปิด 17:00 ทุกวัน)
 * วันเก็บเป็นเลข ISO: 1=จันทร์ ... 7=อาทิตย์ เช่น "123456"
 */
final class PowerSchedule {
    static final String ACTION_ON = "com.icpladda.lis.tv.POWER_ON";
    static final String ACTION_OFF = "com.icpladda.lis.tv.POWER_OFF";

    private static final String PREFS = "lis_home";
    private static final String KEY_ENABLED = "power_schedule";
    private static final String KEY_ON = "power_on_min";
    private static final String KEY_OFF = "power_off_min";
    private static final String KEY_DAYS = "power_on_days";
    static final int DEFAULT_ON = 8 * 60;
    static final int DEFAULT_OFF = 17 * 60;
    static final String DEFAULT_DAYS = "123456";
    static final String[] DAY_SHORT = {"จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."};
    static final String[] DAY_FULL = {"จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"};

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

    static String days(Context c) { return prefs(c).getString(KEY_DAYS, DEFAULT_DAYS); }

    /** รับ "123456" หรือ "1-6" (1=จันทร์ ... 7=อาทิตย์) คืน false ถ้ารูปแบบไม่ถูก */
    static boolean setDays(Context c, String spec) {
        String normalized = normalizeDays(spec);
        if (normalized == null) return false;
        prefs(c).edit().putString(KEY_DAYS, normalized).apply();
        schedule(c);
        return true;
    }

    static String normalizeDays(String spec) {
        if (spec == null) return null;
        String s = spec.trim();
        boolean[] on = new boolean[8];
        if (s.matches("[1-7]-[1-7]")) {
            int a = s.charAt(0) - '0', b = s.charAt(2) - '0';
            if (a > b) return null;
            for (int d = a; d <= b; d++) on[d] = true;
        } else if (s.matches("[1-7]*")) {
            for (char ch : s.toCharArray()) on[ch - '0'] = true;
        } else {
            return null;
        }
        StringBuilder out = new StringBuilder();
        for (int d = 1; d <= 7; d++) if (on[d]) out.append(d);
        return out.toString();
    }

    static boolean isDayOn(String days, int isoDay) { return days.indexOf((char) ('0' + isoDay)) >= 0; }

    /** แสดงเป็น "จ.–ส." ถ้าวันต่อเนื่อง ไม่อย่างนั้นแสดงทีละวัน */
    static String daysLabel(String days) {
        if (days.isEmpty()) return "ไม่เปิดเอง";
        if (days.length() == 7) return "ทุกวัน";
        int first = days.charAt(0) - '0', last = days.charAt(days.length() - 1) - '0';
        if (days.length() >= 3 && last - first + 1 == days.length()) {
            return DAY_SHORT[first - 1] + "–" + DAY_SHORT[last - 1];
        }
        StringBuilder sb = new StringBuilder();
        for (char ch : days.toCharArray()) sb.append(sb.length() > 0 ? " " : "").append(DAY_SHORT[ch - '1']);
        return sb.toString();
    }

    private static int isoDay(Calendar cal) {
        return (cal.get(Calendar.DAY_OF_WEEK) + 5) % 7 + 1;
    }

    static String format(int min) {
        return String.format(Locale.US, "%02d:%02d", min / 60, min % 60);
    }

    /** แบบสั้นสำหรับปุ่ม: 08:00 -> "08", 08:30 -> "08:30" */
    static String formatShort(int min) {
        return min % 60 == 0 ? String.format(Locale.US, "%02d", min / 60) : format(min);
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
        long nextOn = nextOnAt(c);
        if (nextOn > 0) set(am, nextOn, on);
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
        return nextAt(minuteOfDay, "1234567");
    }

    /** เวลาเปิดเครื่องครั้งถัดไปตามวันที่เลือก, -1 ถ้าไม่ได้เลือกวันไหนเลย */
    static long nextOnAt(Context c) {
        return nextAt(onMinutes(c), days(c));
    }

    private static long nextAt(int minuteOfDay, String days) {
        if (days.isEmpty()) return -1;
        Calendar cal = Calendar.getInstance();
        long now = cal.getTimeInMillis();
        cal.set(Calendar.HOUR_OF_DAY, minuteOfDay / 60);
        cal.set(Calendar.MINUTE, minuteOfDay % 60);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        for (int i = 0; i < 8; i++) {
            if (cal.getTimeInMillis() > now + 1000 && isDayOn(days, isoDay(cal))) return cal.getTimeInMillis();
            cal.add(Calendar.DAY_OF_MONTH, 1);
        }
        return -1;
    }
}
