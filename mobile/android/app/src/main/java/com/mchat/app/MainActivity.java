package com.mchat.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ScreenGuardPlugin.class); // свой плагин нужно регистрировать ДО super.onCreate
        super.onCreate(savedInstanceState);
    }
}
