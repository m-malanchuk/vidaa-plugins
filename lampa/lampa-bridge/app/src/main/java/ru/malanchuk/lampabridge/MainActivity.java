package ru.malanchuk.lampabridge;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import ru.malanchuk.lampabridge.service.ProxyService;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION = 42;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView status;
    private TextView ipText;
    private TextView bridgeUrlText;
    private TextView requestText;
    private EditText portInput;
    private Button toggleButton;
    private BroadcastReceiver receiver;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(16, 16, 20));
        getWindow().setNavigationBarColor(Color.rgb(16, 16, 20));
        setContentView(createContent());
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                refreshState(intent == null ? null : intent.getStringExtra(ProxyService.EXTRA_ERROR));
            }
        };
        IntentFilter filter = new IntentFilter(ProxyService.ACTION_STATUS);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, RECEIVER_NOT_EXPORTED);
        else registerReceiver(receiver, filter);
        refreshState(null);
    }

    @Override
    protected void onStop() {
        if (receiver != null) unregisterReceiver(receiver);
        receiver = null;
        super.onStop();
    }

    private View createContent() {
        int background = Color.rgb(16, 16, 20);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(background);
        scroll.setClipToPadding(false);

        FrameLayout viewport = new FrameLayout(this);
        viewport.setBackgroundColor(background);
        scroll.addView(viewport, new ScrollView.LayoutParams(-1, -1));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(0, dp(18), 0, dp(24));
        root.setBackgroundColor(background);

        int screenWidth = getResources().getConfiguration().screenWidthDp;
        int horizontalMargin = screenWidth < 360 ? 16 : screenWidth < 600 ? 20 : 32;
        int contentWidth = Math.min(600, Math.max(0, screenWidth - horizontalMargin * 2));
        FrameLayout.LayoutParams rootParams = new FrameLayout.LayoutParams(dp(contentWidth), -2);
        rootParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        viewport.addView(root, rootParams);

        TextView title = text(getString(R.string.app_name), 28, Color.WHITE);
        root.addView(title, widthMatch());
        TextView subtitle = text(getString(R.string.app_subtitle), 14, Color.rgb(190, 186, 200));
        root.addView(subtitle, widthMatchWithTop(4));

        status = text(getString(R.string.bridge_stopped), 17, Color.rgb(220, 190, 190));
        root.addView(status, widthMatchWithTop(28));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        card.setBackground(roundedBackground(Color.rgb(38, 36, 44), 14));
        root.addView(card, widthMatchWithTop(12));

        TextView ipLabel = text(getString(R.string.local_ip_label), 12, Color.rgb(190, 186, 200));
        card.addView(ipLabel, widthMatch());
        ipText = text(getString(R.string.detecting_ip), 25, Color.rgb(235, 220, 255));
        ipText.setTypeface(android.graphics.Typeface.MONOSPACE);
        card.addView(ipText, widthMatchWithTop(5));

        TextView urlLabel = text(getString(R.string.bridge_url_label), 12, Color.rgb(190, 186, 200));
        card.addView(urlLabel, widthMatchWithTop(16));
        bridgeUrlText = text("http://…:8080/", 18, Color.WHITE);
        bridgeUrlText.setTypeface(android.graphics.Typeface.MONOSPACE);
        bridgeUrlText.setAutoSizeTextTypeUniformWithConfiguration(13, 18, 1, TypedValue.COMPLEX_UNIT_SP);
        card.addView(bridgeUrlText, widthMatchWithTop(5));

        TextView portLabel = text(getString(R.string.bridge_port_label), 15, Color.WHITE);
        root.addView(portLabel, widthMatchWithTop(18));

        portInput = new EditText(this);
        portInput.setText(String.valueOf(getPreferences(MODE_PRIVATE).getInt("port", 8080)));
        portInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        portInput.setTextColor(Color.WHITE);
        portInput.setTextSize(18);
        portInput.setSingleLine(true);
        portInput.setPadding(dp(16), 0, dp(16), 0);
        portInput.setBackground(roundedStrokeBackground(Color.rgb(27, 26, 32), Color.rgb(113, 91, 151), 12));
        portInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { refreshState(null); }
            @Override public void afterTextChanged(Editable s) { }
        });
        LinearLayout.LayoutParams portParams = new LinearLayout.LayoutParams(-1, dp(54));
        portParams.topMargin = dp(7);
        root.addView(portInput, portParams);

        TextView portHint = text(getString(R.string.bridge_port_hint), 12, Color.rgb(150, 148, 160));
        root.addView(portHint, widthMatchWithTop(6));

        toggleButton = new Button(this);
        toggleButton.setText(R.string.bridge_start);
        toggleButton.setOnClickListener(v -> toggleBridge());
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(-1, dp(56));
        buttonParams.topMargin = dp(14);
        root.addView(toggleButton, buttonParams);

        requestText = text(getString(R.string.request_count, 0), 14, Color.rgb(190, 186, 200));
        root.addView(requestText, widthMatchWithTop(18));

        TextView hint = text(getString(R.string.network_hint), 14, Color.rgb(190, 186, 200));
        hint.setLineSpacing(0, 1.15f);
        root.addView(hint, widthMatchWithTop(14));

        TextView security = text(getString(R.string.security_hint), 13, Color.rgb(150, 148, 160));
        security.setLineSpacing(0, 1.15f);
        root.addView(security, widthMatchWithTop(18));

        return scroll;
    }

    private void toggleBridge() {
        if (ProxyService.isRunning()) {
            stopService(new Intent(this, ProxyService.class).setAction(ProxyService.ACTION_STOP));
            refreshState(null);
            return;
        }
        int port;
        try { port = Integer.parseInt(portInput.getText().toString().trim()); }
        catch (Exception error) { Toast.makeText(this, R.string.port_not_number, Toast.LENGTH_SHORT).show(); return; }
        if (port < 1024 || port > 65535) { Toast.makeText(this, R.string.port_out_of_range, Toast.LENGTH_SHORT).show(); return; }
        getPreferences(MODE_PRIVATE).edit().putInt("port", port).apply();
        Intent intent = new Intent(this, ProxyService.class).setAction(ProxyService.ACTION_START).putExtra(ProxyService.EXTRA_PORT, port);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent); else startService(intent);
        handler.postDelayed(() -> refreshState(null), 250);
    }

    private void refreshState(String error) {
        String ip = getLocalIpv4();
        int port = 8080;
        try { port = Integer.parseInt(portInput == null ? "8080" : portInput.getText().toString()); } catch (Exception ignored) { }
        ipText.setText(ip == null ? getString(R.string.ip_not_found) : ip);
        bridgeUrlText.setText("http://" + (ip == null ? getString(R.string.phone_ip_placeholder) : ip) + ":" + port + "/");
        if (error != null && !error.isEmpty()) {
            status.setText(getString(R.string.error_message, error));
            status.setTextColor(Color.rgb(255, 150, 150));
        } else if (ProxyService.isRunning()) {
            status.setText(R.string.bridge_running);
            status.setTextColor(Color.rgb(150, 235, 170));
        } else {
            status.setText(R.string.bridge_stopped);
            status.setTextColor(Color.rgb(220, 190, 190));
        }
        toggleButton.setText(ProxyService.isRunning() ? R.string.bridge_stop : R.string.bridge_start);
        requestText.setText(getString(R.string.request_count, ProxyService.requestCount()));
    }

    private String getLocalIpv4() {
        String fallback = null;
        try {
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) continue;
                    if (address.isSiteLocalAddress()) return address.getHostAddress();
                    if (fallback == null) fallback = address.getHostAddress();
                }
            }
        } catch (Exception ignored) { }
        return fallback;
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private LinearLayout.LayoutParams widthMatch() { return new LinearLayout.LayoutParams(-1, -2); }
    private LinearLayout.LayoutParams widthMatchWithTop(int top) {
        LinearLayout.LayoutParams params = widthMatch();
        params.topMargin = dp(top);
        return params;
    }
    private GradientDrawable roundedBackground(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }
    private GradientDrawable roundedStrokeBackground(int color, int strokeColor, int radius) {
        GradientDrawable drawable = roundedBackground(color, radius);
        drawable.setStroke(dp(1), strokeColor);
        return drawable;
    }
    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density + 0.5f); }
}
