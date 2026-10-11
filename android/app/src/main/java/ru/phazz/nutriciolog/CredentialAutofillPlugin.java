package ru.phazz.nutriciolog;

import android.view.autofill.AutofillManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Ends the system autofill context, without receiving or storing credentials. */
@CapacitorPlugin(name = "CredentialAutofill")
public class CredentialAutofillPlugin extends Plugin {
    @PluginMethod
    public void completeLogin(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                AutofillManager manager = getActivity().getSystemService(AutofillManager.class);
                if (manager != null && manager.isEnabled()) manager.commit();
                call.resolve();
            } catch (RuntimeException error) {
                // Autofill is optional and must never prevent account access.
                call.reject("System autofill unavailable");
            }
        });
    }
}
