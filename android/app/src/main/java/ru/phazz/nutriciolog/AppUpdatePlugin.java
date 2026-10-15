package ru.phazz.nutriciolog;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Reads public APK metadata; downloading and installation always require a user action. */
@CapacitorPlugin(name = "NutritionAppUpdate")
public class AppUpdatePlugin extends Plugin {
    private static final String BASE = "https://nutriciolog-x20.website.yandexcloud.net/";
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private volatile String updateUrl;

    private JSObject installed() throws Exception {
        PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
        JSObject result = new JSObject();
        result.put("currentVersion", info.versionName);
        result.put("currentCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
        return result;
    }

    @PluginMethod
    public void getVersion(PluginCall call) {
        try { call.resolve(installed()); }
        catch (Exception error) { call.reject("Не удалось определить версию приложения."); }
    }

    @PluginMethod
    public void checkUpdate(PluginCall call) {
        network.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(BASE + "android-release.json").openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setUseCaches(false);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("Cache-Control", "no-cache");
                if (connection.getResponseCode() != 200) throw new Exception("Unavailable metadata");
                JSONObject release;
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[2048];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (output.size() + count > 16384) throw new Exception("Oversized metadata");
                        output.write(buffer, 0, count);
                    }
                    release = new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
                }
                String version = release.getString("version");
                long code = release.getLong("versionCode");
                int minSdk = release.getInt("minSdkVersion");
                String url = release.getString("url");
                if (!getContext().getPackageName().equals(release.getString("appId"))
                    || !version.matches("[0-9]+[.][0-9]+[.][0-9]+") || code < 1 || code > Integer.MAX_VALUE
                    || minSdk < 26 || !url.equals(BASE + "downloads/nutriciolog-" + version + ".apk")) {
                    throw new Exception("Invalid release metadata");
                }
                JSObject result = installed();
                boolean newer = code > result.getLong("currentCode");
                boolean compatible = Build.VERSION.SDK_INT >= minSdk;
                boolean available = newer && compatible;
                updateUrl = available ? url : null;
                result.put("available", available);
                result.put("requiresNewerAndroid", newer && !compatible);
                result.put("version", version);
                result.put("versionCode", code);
                call.resolve(result);
            } catch (Exception error) {
                // A transient failure must not discard an already checked download URL.
                call.reject("Не удалось проверить обновления. Проверьте интернет и попробуйте ещё раз.");
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void openUpdate(PluginCall call) {
        String url = updateUrl;
        if (url == null) { call.reject("Сначала проверьте наличие обновления."); return; }
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                getActivity().startActivity(intent);
                call.resolve();
            } catch (Exception error) {
                call.reject("Не удалось открыть браузер для скачивания APK.");
            }
        });
    }

    @Override
    protected void handleOnResume() {
        notifyListeners("resume", new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        network.shutdownNow();
        updateUrl = null;
    }
}
