package com.mchat.app;

import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Защита экрана для одноразовых фото: пока открыто такое фото, окно помечено FLAG_SECURE —
 * Android не даёт сделать системный скриншот/запись экрана и скрывает содержимое в «недавних».
 * Вызывается из веб-слоя (mchat-series7.js → MchatNative.setSecure). Не защищает от съёмки другим устройством.
 */
@CapacitorPlugin(name = "ScreenGuard")
public class ScreenGuardPlugin extends Plugin {

    @PluginMethod
    public void setSecure(final PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            if (enabled) w.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else w.clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            JSObject ret = new JSObject();
            ret.put("enabled", enabled);
            call.resolve(ret);
        });
    }
}
