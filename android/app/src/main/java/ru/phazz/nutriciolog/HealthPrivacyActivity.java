package ru.phazz.nutriciolog;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;

/** The same bundled privacy policy shown in the app, with no JS bridge. */
public class HealthPrivacyActivity extends Activity {
    private WebView policyView;
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        policyView = new WebView(this);
        policyView.getSettings().setJavaScriptEnabled(false);
        policyView.getSettings().setAllowFileAccess(true);
        policyView.getSettings().setAllowContentAccess(false);
        setContentView(policyView);
        policyView.loadUrl("file:///android_asset/public/privacy.html");
    }
    @Override public void onDestroy() {
        if (policyView != null) policyView.destroy();
        super.onDestroy();
    }
}
