package com.icpladda.lis.tv;

import android.app.admin.DevicePolicyManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.util.Log;

/** รับ alarm เปิด/ปิดจอ และตั้ง alarm ใหม่หลังบูตหรือเปลี่ยนเวลาเครื่อง */
public class PowerReceiver extends BroadcastReceiver {
    private static final String TAG = "LisHome";
    /** ทีวี Xiaomi เข้าโหมดหลับลึก (STR) หลังปิดจอ ~2.5 นาที ทำให้ alarm เปิดเครื่องช้า จึงกันไว้ระหว่างรอเวลาเปิด */
    private static PowerManager.WakeLock standbyLock;

    static synchronized void releaseStandbyLock() {
        if (standbyLock != null && standbyLock.isHeld()) standbyLock.release();
        standbyLock = null;
    }

    private static synchronized void holdUntilPowerOn(Context context) {
        releaseStandbyLock();
        long wait = PowerSchedule.nextAt(PowerSchedule.onMinutes(context)) - System.currentTimeMillis() + 5 * 60_000L;
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        standbyLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lis:standby");
        standbyLock.setReferenceCounted(false);
        standbyLock.acquire(Math.max(wait, 60_000L));
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (PowerSchedule.ACTION_ON.equals(action)) {
            Log.i(TAG, "scheduled power on");
            releaseStandbyLock();
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                    | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE, "lis:power-on");
            wl.acquire(10_000);
            Startup.pending = true;
            Intent home = new Intent(context, MainActivity.class)
                    .putExtra(MainActivity.EXTRA_WAKE, true)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                context.startActivity(home);
            } catch (RuntimeException e) {
                Log.w(TAG, "start home failed", e);
            }
        } else if (PowerSchedule.ACTION_OFF.equals(action)) {
            Log.i(TAG, "scheduled power off");
            DevicePolicyManager dpm = (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin = new ComponentName(context, AdminReceiver.class);
            if (dpm.isAdminActive(admin)) {
                holdUntilPowerOn(context);
                dpm.lockNow();
            } else {
                Log.w(TAG, "device admin not active: cannot turn screen off");
            }
        }
        PowerSchedule.schedule(context);
    }
}
