package com.onelineart.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugin (saving/sharing exports); must be registered before the bridge starts.
        registerPlugin(MediaExportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
