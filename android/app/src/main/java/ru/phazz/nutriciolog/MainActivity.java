package ru.phazz.nutriciolog;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.view.View;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HealthConnectPlugin.class);
        registerPlugin(CredentialAutofillPlugin.class);
        registerPlugin(AppearancePlugin.class);
        registerPlugin(ShareImagePlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null) {
            getBridge().getWebView().setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
        }
    }
}
