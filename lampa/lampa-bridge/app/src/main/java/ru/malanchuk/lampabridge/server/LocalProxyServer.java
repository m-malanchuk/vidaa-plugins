package ru.malanchuk.lampabridge.server;

import ru.malanchuk.lampabridge.BuildConfig;
import ru.malanchuk.lampabridge.protocol.Enc2Decoder;
import ru.malanchuk.lampabridge.protocol.ProxyCommand;
import ru.malanchuk.lampabridge.network.UpstreamResponse;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/** Small local HTTP server. It intentionally has no third-party runtime dependency. */
public final class LocalProxyServer {
    public interface Listener {
        void onRequest(String method, String host, int status, long elapsedMs);
        void onError(String message);
    }

    private static final int MAX_HEADER_BYTES = 64 * 1024;
    private static final int MAX_BODY_BYTES = 8 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;
    private static final Set<String> ALLOWED_HOSTS = new HashSet<>(Arrays.asList(
            "rezka.ag", "rezka.si", "hdrezka.ag", "hdrezka.co", "rezka-ua.tv", "hdrzk.org", "kvk.zone",
            "statichdrezka.ac"
    ));

    private final int port;
    private final Listener listener;
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final AtomicInteger requestCount = new AtomicInteger();
    private volatile boolean running;
    private ServerSocket serverSocket;

    public LocalProxyServer(int port, Listener listener) {
        this.port = port;
        this.listener = listener;
    }

    public void start() throws IOException {
        if (running) return;
        serverSocket = new ServerSocket(port, 32, InetAddress.getByName("0.0.0.0"));
        running = true;
        workers.submit(() -> {
            while (running) {
                try {
                    Socket socket = serverSocket.accept();
                    workers.submit(() -> handle(socket));
                } catch (IOException error) {
                    if (running && listener != null) listener.onError(error.getMessage());
                }
            }
        });
    }

    public void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
        workers.shutdownNow();
    }

    public boolean isRunning() { return running; }
    public int getRequestCount() { return requestCount.get(); }

    private void handle(Socket socket) {
        long started = System.currentTimeMillis();
        String method = "?";
        String hostForLog = "local";
        int status = 500;
        try (Socket ignored = socket;
             BufferedInputStream input = new BufferedInputStream(socket.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(socket.getOutputStream())) {
            HttpRequest request = readRequest(input);
            method = request.method;
            if (!isLocalClient(socket.getInetAddress())) {
                status = 403;
                writeResponse(output, status, "Forbidden", "Only local network clients are allowed", "text/plain; charset=utf-8");
                return;
            }
            if ("OPTIONS".equalsIgnoreCase(method)) {
                status = 204;
                writeEmpty(output, status, "No Content");
                return;
            }
            if (!("GET".equals(method) || "POST".equals(method) || "HEAD".equals(method))) {
                status = 405;
                writeResponse(output, status, "Method Not Allowed", "Only GET, POST and HEAD are supported", "text/plain; charset=utf-8");
                return;
            }
            String path = request.target;
            if (path.equals("/health") || path.equals("/health/")) {
                status = 200;
                writeResponse(output, status, "OK", "{\"ok\":true,\"service\":\"lampa-bridge\",\"version\":\"" + json(BuildConfig.VERSION_NAME) + "\"}", "application/json; charset=utf-8");
                return;
            }
            if (path.equals("/header") || path.equals("/header/") || path.equals("/headers") || path.equals("/headers/")) {
                status = 200;
                String safe = "{\"service\":\"lampa-bridge\",\"version\":\"" + json(BuildConfig.VERSION_NAME) + "\",\"method\":\"" + json(request.method) + "\",\"client\":\"" + json(socket.getInetAddress().getHostAddress()) + "\"}";
                writeResponse(output, status, "OK", safe, "application/json; charset=utf-8");
                return;
            }
            if (path.equals("/jsonip") || path.equals("/jsonip/")) {
                status = 200;
                String safe = "{\"ip\":\"" + json(socket.getInetAddress().getHostAddress()) + "\"}";
                writeResponse(output, status, "OK", safe, "application/json; charset=utf-8");
                return;
            }
            if (!path.contains("/enc2/")) {
                status = 404;
                writeResponse(output, status, "Not Found", "Not found", "text/plain; charset=utf-8");
                return;
            }

            ProxyCommand command = Enc2Decoder.decode(path);
            URL target = new URL(command.targetUrl);
            hostForLog = target.getHost();
            if (!isAllowedHost(target)) {
                status = 403;
                writeResponse(output, status, "Forbidden", "Target domain is not allowed", "text/plain; charset=utf-8");
                return;
            }

            UpstreamResponse upstream = execute(command, request.method, request.body);
            status = upstream.statusCode;
            byte[] responseBody;
            String contentType = upstream.headers.getOrDefault("content-type", "application/octet-stream");
            if (command.cookie || command.cookiePlus || command.getRedirect) {
                responseBody = jsonEnvelope(command, upstream, contentType).getBytes(StandardCharsets.UTF_8);
                writeBytes(output, 200, "OK", responseBody, "application/json; charset=utf-8", Collections.emptyMap());
                status = 200;
            } else {
                writeBytes(output, upstream.statusCode, reason(upstream.statusCode), upstream.body, contentType, upstream.headers);
            }
        } catch (Throwable error) {
            try {
                if (socket.isConnected() && !socket.isClosed()) {
                    OutputStream output = socket.getOutputStream();
                    writeResponse(output, 502, "Bad Gateway", "Proxy error: " + error.getClass().getSimpleName(), "text/plain; charset=utf-8");
                }
            } catch (IOException ignored) {
            }
            if (listener != null) listener.onError(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            status = 502;
        } finally {
            requestCount.incrementAndGet();
            if (listener != null) listener.onRequest(method, hostForLog, status, System.currentTimeMillis() - started);
        }
    }

    private UpstreamResponse execute(ProxyCommand command, String incomingMethod, byte[] body) throws IOException {
        URL target = new URL(command.targetUrl);
        String method = command.forceHead ? "HEAD" : ("POST".equals(incomingMethod) ? "POST" : ("HEAD".equals(incomingMethod) ? "HEAD" : "GET"));
        byte[] requestBody = body;
        boolean followRedirects = !command.getRedirect
                && !"manual".equalsIgnoreCase(command.redirectMode)
                && !"POST".equals(method);

        for (int redirectCount = 0; ; redirectCount++) {
            if (!isAllowedHost(target)) throw new IOException("Redirect target domain is not allowed");
            HttpURLConnection connection = (HttpURLConnection) target.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Origin", command.headers.getOrDefault("Origin", target.getProtocol() + "://" + target.getHost()));
            connection.setRequestProperty("Referer", command.headers.getOrDefault("Referer", target.getProtocol() + "://" + target.getHost() + "/"));
            for (Map.Entry<String, String> header : command.headers.entrySet()) {
                String name = header.getKey();
                if (isUnsafeHeader(name)) continue;
                connection.setRequestProperty(name, header.getValue());
            }
            if (requestBody.length > 0 && !("GET".equals(method) || "HEAD".equals(method))) {
                connection.setDoOutput(true);
                if (!connection.getRequestProperties().containsKey("Content-Type")) {
                    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
                }
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(requestBody);
                }
            }

            UpstreamResponse response = new UpstreamResponse();
            response.currentUrl = target.toString();
            response.statusCode = connection.getResponseCode();
            for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                if (entry.getKey() == null || entry.getValue() == null || entry.getValue().isEmpty()) continue;
                String key = entry.getKey().toLowerCase(Locale.US);
                if ("set-cookie".equals(key)) response.cookies.addAll(entry.getValue());
                else if (!"transfer-encoding".equals(key)) response.headers.put(key, entry.getValue().get(0));
            }
            String location = connection.getHeaderField("Location");
            if (location != null) response.headers.put("location", location);
            InputStream stream = response.statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream != null && !"HEAD".equals(method)) {
                try (InputStream input = stream) {
                    response.body = readLimited(input, MAX_BODY_BYTES);
                }
            }
            connection.disconnect();

            if (!followRedirects || !isRedirect(response.statusCode) || location == null || redirectCount >= MAX_REDIRECTS) {
                return response;
            }

            target = new URL(new URL(target.toString()), location);
            if (response.statusCode == 303 || ((response.statusCode == 301 || response.statusCode == 302) && "POST".equals(method))) {
                method = "GET";
                requestBody = new byte[0];
            }
        }
    }

    private static boolean isRedirect(int status) {
        return status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
    }

    private static String jsonEnvelope(ProxyCommand command, UpstreamResponse response, String contentType) {
        StringBuilder json = new StringBuilder("{\"currentUrl\":\"").append(json(response.currentUrl)).append('"');
        String location = response.headers.get("location");
        if (command.getRedirect && location != null) {
            json.append(",\"redirectUrl\":\"").append(json(resolveLocation(response.currentUrl, location))).append('"');
        }
        if (command.cookie || command.cookiePlus) {
            json.append(",\"cookie\":[");
            for (int i = 0; i < response.cookies.size(); i++) {
                if (i > 0) json.append(',');
                json.append('"').append(json(response.cookies.get(i))).append('"');
            }
            json.append(']');
        }
        if (command.cookiePlus) {
            json.append(",\"headers\":{");
            boolean first = true;
            for (Map.Entry<String, String> header : response.headers.entrySet()) {
                if (!first) json.append(',');
                first = false;
                json.append('"').append(json(header.getKey())).append("\":\"").append(json(header.getValue())).append('"');
            }
            if (!first) json.append(',');
            json.append("\"set-cookie\":[");
            for (int i = 0; i < response.cookies.size(); i++) {
                if (i > 0) json.append(',');
                json.append('"').append(json(response.cookies.get(i))).append('"');
            }
            json.append(']');
            json.append('}');
            if (isText(contentType)) {
                json.append(",\"body\":\"").append(json(new String(response.body, StandardCharsets.UTF_8))).append('"');
            }
        }
        return json.append('}').toString();
    }

    private static boolean isAllowedHost(URL target) {
        if (!"http".equalsIgnoreCase(target.getProtocol()) && !"https".equalsIgnoreCase(target.getProtocol())) return false;
        String host = target.getHost().toLowerCase(Locale.US);
        for (String allowed : ALLOWED_HOSTS) {
            if (host.equals(allowed) || host.endsWith("." + allowed)) return true;
        }
        return false;
    }

    private static boolean isLocalClient(InetAddress address) {
        return address.isLoopbackAddress() || address.isSiteLocalAddress() || address.isLinkLocalAddress();
    }

    private static boolean isUnsafeHeader(String name) {
        String lower = name.toLowerCase(Locale.US);
        return lower.equals("host") || lower.equals("connection") || lower.equals("content-length") || lower.equals("transfer-encoding") || lower.equals("proxy-connection") || lower.equals("cdn-loop");
    }

    private static String resolveLocation(String current, String location) {
        try { return new URL(new URL(current), location).toString(); } catch (Exception ignored) { return location; }
    }

    private static byte[] readLimited(InputStream input, int max) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int total = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > max) throw new IOException("upstream response is too large");
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private static final class HttpRequest {
        String method;
        String target;
        byte[] body = new byte[0];
    }

    private static HttpRequest readRequest(InputStream input) throws IOException {
        HttpRequest request = new HttpRequest();
        String requestLine = readLine(input, MAX_HEADER_BYTES);
        if (requestLine == null) throw new IOException("empty request");
        String[] line = requestLine.split(" ", 3);
        if (line.length < 2) throw new IOException("invalid request line");
        request.method = line[0].toUpperCase(Locale.US);
        request.target = line[1];
        int contentLength = 0;
        while (true) {
            String header = readLine(input, MAX_HEADER_BYTES);
            if (header == null || header.isEmpty()) break;
            int colon = header.indexOf(':');
            if (colon < 0) continue;
            if ("content-length".equalsIgnoreCase(header.substring(0, colon).trim())) {
                try { contentLength = Integer.parseInt(header.substring(colon + 1).trim()); } catch (NumberFormatException ignored) { }
            }
        }
        if (contentLength < 0 || contentLength > MAX_BODY_BYTES) throw new IOException("request body is too large");
        if (contentLength > 0) request.body = readExact(input, contentLength);
        return request;
    }

    private static byte[] readExact(InputStream input, int length) throws IOException {
        byte[] body = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = input.read(body, offset, length - offset);
            if (read == -1) throw new IOException("request body is incomplete");
            offset += read;
        }
        return body;
    }

    private static String readLine(InputStream input, int max) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        int previous = -1;
        int current;
        while ((current = input.read()) != -1) {
            if (output.size() > max) throw new IOException("headers are too large");
            if (previous == '\r' && current == '\n') {
                byte[] bytes = output.toByteArray();
                return new String(bytes, 0, Math.max(0, bytes.length - 1), StandardCharsets.ISO_8859_1);
            }
            output.write(current);
            previous = current;
        }
        return output.size() == 0 ? null : new String(output.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static void writeEmpty(OutputStream output, int status, String reason) throws IOException {
        writeBytes(output, status, reason, new byte[0], "text/plain; charset=utf-8", Collections.emptyMap());
    }

    private static void writeResponse(OutputStream output, int status, String reason, String body, String contentType) throws IOException {
        writeBytes(output, status, reason, body.getBytes(StandardCharsets.UTF_8), contentType, Collections.emptyMap());
    }

    private static void writeBytes(OutputStream output, int status, String reason, byte[] body, String contentType, Map<String, String> headers) throws IOException {
        StringBuilder head = new StringBuilder("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
        head.append("Content-Type: ").append(contentType).append("\r\n");
        head.append("Content-Length: ").append(body.length).append("\r\n");
        head.append("Access-Control-Allow-Origin: *\r\n");
        head.append("Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS\r\n");
        head.append("Access-Control-Max-Age: 86400\r\n");
        head.append("Access-Control-Allow-Headers: Content-Type, Range, Authorization, X-Requested-With, Access-Control-Request-Private-Network\r\n");
        head.append("Access-Control-Allow-Private-Network: true\r\n");
        head.append("Access-Control-Expose-Headers: Content-Type, Content-Length, Content-Range, Accept-Ranges\r\n");
        head.append("Vary: Origin\r\nConnection: close\r\n");
        for (Map.Entry<String, String> header : headers.entrySet()) {
            String key = header.getKey();
            if (key.equalsIgnoreCase("content-type") || key.equalsIgnoreCase("content-length") || key.equalsIgnoreCase("connection") || key.equalsIgnoreCase("transfer-encoding")) continue;
            if (key.equalsIgnoreCase("location")) head.append("Location: ").append(header.getValue()).append("\r\n");
            else if (key.equalsIgnoreCase("set-cookie")) head.append("Set-Cookie: ").append(header.getValue()).append("\r\n");
        }
        head.append("\r\n");
        output.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
        output.write(body);
        output.flush();
    }

    private static boolean isText(String contentType) {
        String lower = contentType == null ? "" : contentType.toLowerCase(Locale.US);
        return lower.startsWith("text/") || lower.contains("json") || lower.contains("xml") || lower.contains("mpegurl") || lower.contains("dash+xml");
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 204: return "No Content";
            case 301: return "Moved Permanently";
            case 302: return "Found";
            case 303: return "See Other";
            case 307: return "Temporary Redirect";
            case 308: return "Permanent Redirect";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 500: return "Internal Server Error";
            case 502: return "Bad Gateway";
            case 504: return "Gateway Timeout";
            default: return "Proxy Response";
        }
    }

    private static String json(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t");
    }
}
