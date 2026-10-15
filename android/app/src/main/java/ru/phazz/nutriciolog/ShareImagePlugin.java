package ru.phazz.nutriciolog;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Receives a single image from Android's Share sheet without storing a copy. */
@CapacitorPlugin(name = "NutritionShareImage")
public class ShareImagePlugin extends Plugin {
    private static final int MAX_BYTES = 4 * 1024 * 1024;
    private final ExecutorService reader = Executors.newSingleThreadExecutor();
    private JSObject pending;

    @Override
    public void load() {
        receive(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        receive(intent);
    }

    @SuppressWarnings("deprecation")
    private void receive(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        Uri uri;
        try {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null && intent.getClipData() != null && intent.getClipData().getItemCount() > 0) {
                uri = intent.getClipData().getItemAt(0).getUri();
            }
        } catch (RuntimeException error) {
            publishError("Не удалось получить изображение. Поделитесь им ещё раз.");
            return;
        }
        // Do not re-import the same attachment when the activity is recreated.
        intent.removeExtra(Intent.EXTRA_STREAM);
        intent.setClipData(null);
        intent.setAction(Intent.ACTION_MAIN);
        if (uri == null || !"content".equals(uri.getScheme())) {
            publishError("Не удалось открыть изображение. Выберите его в галерее.");
            return;
        }
        final Uri sharedUri = uri;
        final String declaredType = intent.getType();
        reader.execute(() -> {
            try {
                String mime = getContext().getContentResolver().getType(sharedUri);
                if (mime == null) mime = declaredType;
                if (!"image/jpeg".equals(mime) && !"image/png".equals(mime) && !"image/webp".equals(mime)) {
                    publishError("Используйте JPEG, PNG или WebP.");
                    return;
                }
                try (InputStream input = getContext().getContentResolver().openInputStream(sharedUri);
                     ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (input == null) throw new java.io.IOException("Missing stream");
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (output.size() + count > MAX_BYTES) {
                            publishError("Фото должно быть не больше 4 МБ");
                            return;
                        }
                        output.write(buffer, 0, count);
                    }
                    JSObject image = new JSObject();
                    image.put("mimeType", mime);
                    image.put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                    publish(image);
                }
            } catch (Exception error) {
                publishError("Не удалось прочитать изображение. Поделитесь им ещё раз.");
            }
        });
    }

    private void publishError(String message) {
        JSObject result = new JSObject();
        result.put("error", message);
        publish(result);
    }

    private void publish(JSObject result) {
        synchronized (this) { pending = result; }
        // Retain only a signal until JS is ready, not the image itself.
        notifyListeners("imageAvailable", new JSObject(), true);
    }

    @PluginMethod
    public synchronized void consumeImage(PluginCall call) {
        JSObject result = pending;
        pending = null;
        call.resolve(result == null ? new JSObject() : result);
    }

    @Override
    protected void handleOnDestroy() {
        reader.shutdownNow();
        synchronized (this) { pending = null; }
    }
}
