package ru.phazz.nutriciolog;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.Window;
import androidx.core.view.WindowCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Matches the system navigation area to the resolved web theme. */
@CapacitorPlugin(name = "NutritionAppearance")
public class AppearancePlugin extends Plugin {
    @PluginMethod
    public void setTheme(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            int color = dark ? Color.BLACK : Color.WHITE;
            window.setNavigationBarColor(color);
            window.setBackgroundDrawable(new ColorDrawable(color));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                window.setNavigationBarDividerColor(color);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.setNavigationBarContrastEnforced(false);
            }
            WindowCompat.getInsetsController(window, window.getDecorView())
                .setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }
}
