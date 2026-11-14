package ru.malanchuk.lampabridge.server;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public final class LocalProxyServerTest {
    @Test
    public void healthEndpointReturnsCorsHeaders() throws Exception {
        int port;
        try (ServerSocket socket = new ServerSocket(0)) {
            port = socket.getLocalPort();
        }

        LocalProxyServer server = new LocalProxyServer(port, null);
        server.start();
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + port + "/health").openConnection();
            connection.setConnectTimeout(2000);
            connection.setReadTimeout(2000);
            assertEquals(200, connection.getResponseCode());
            assertEquals("*", connection.getHeaderField("Access-Control-Allow-Origin"));
            String body = read(connection.getInputStream());
            assertTrue(body.contains("\"ok\":true"));
            assertTrue(body.contains("\"service\":\"lampa-bridge\""));
            assertTrue(body.contains("\"version\":\"1.0.0\""));
        } finally {
            server.stop();
        }
    }

    private static String read(InputStream input) throws Exception {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int count;
            while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
