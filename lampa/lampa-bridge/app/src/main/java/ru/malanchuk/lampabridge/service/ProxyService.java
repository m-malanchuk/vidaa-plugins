package ru.malanchuk.lampabridge.service;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import ru.malanchuk.lampabridge.MainActivity;
import ru.malanchuk.lampabridge.R;
import ru.malanchuk.lampabridge.server.LocalProxyServer;

public final class ProxyService extends Service {
    public static final String ACTION_START = "ru.malanchuk.lampabridge.START";
    public static final String ACTION_STOP = "ru.malanchuk.lampabridge.STOP";
    public static final String EXTRA_PORT = "port";
    public static final String ACTION_STATUS = "ru.malanchuk.lampabridge.STATUS";
    public static final String EXTRA_RUNNING = "running";
    public static final String EXTRA_ERROR = "error";
    private static final String CHANNEL_ID = "lampa_bridge_service";
    private static volatile ProxyService instance;

    private LocalProxyServer server;
    private int port = 8080;

    public static boolean isRunning() {
        return instance != null && instance.server != null && instance.server.isRunning();
    }

    public static int requestCount() {
        return isRunning() ? instance.server.getRequestCount() : 0;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopProxy();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null) port = intent.getIntExtra(EXTRA_PORT, 8080);
        startForeground(1001, notification(getString(R.string.notification_starting, port)));
        if (!isRunning()) {
            try {
                server = new LocalProxyServer(port, new LocalProxyServer.Listener() {
                    @Override public void onRequest(String method, String host, int status, long elapsedMs) {
                        sendStatus(null);
                        updateNotification(getString(R.string.notification_request_count, server.getRequestCount()));
                    }

                    @Override public void onError(String message) {
                        sendStatus(message == null ? getString(R.string.bridge_error) : message);
                    }
                });
                server.start();
                updateNotification(getString(R.string.notification_running, port));
                sendStatus(null);
            } catch (Exception error) {
                sendStatus(error.getMessage() == null ? getString(R.string.server_start_error) : error.getMessage());
                stopSelf();
            }
        }
        return START_NOT_STICKY;
    }

    private void stopProxy() {
        if (server != null) server.stop();
        server = null;
        sendStatus(null);
    }

    @Override
    public void onDestroy() {
        stopProxy();
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel_name), NotificationManager.IMPORTANCE_LOW);
            channel.setDescription(getString(R.string.notification_channel_description));
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private Notification notification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent openPending = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, ProxyService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 2, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return builder.setContentTitle(getString(R.string.notification_title))
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentIntent(openPending)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause, getString(R.string.notification_stop), stopPending).build())
                .build();
    }

    private void updateNotification(String text) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(1001, notification(text));
    }

    private void sendStatus(String error) {
        Intent intent = new Intent(ACTION_STATUS);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_RUNNING, isRunning());
        if (error != null) intent.putExtra(EXTRA_ERROR, error);
        sendBroadcast(intent);
    }
}
