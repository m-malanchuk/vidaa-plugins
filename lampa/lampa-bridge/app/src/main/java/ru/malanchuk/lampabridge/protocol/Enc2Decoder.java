package ru.malanchuk.lampabridge.protocol;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/** Decodes the enc2 command format used by the current Lampa Worker. */
public final class Enc2Decoder {
    private Enc2Decoder() {}

    public static ProxyCommand decode(String requestTarget) throws Exception {
        int encIndex = requestTarget.indexOf("/enc2/");
        if (encIndex < 0) throw new IllegalArgumentException("enc2 path is missing");

        String after = requestTarget.substring(encIndex + "/enc2/".length());
        int slash = after.indexOf('/');
        String encoded = slash >= 0 ? after.substring(0, slash) : after;
        String decoded = new String(Base64.getDecoder().decode(URLDecoder.decode(encoded, "UTF-8")), StandardCharsets.UTF_8);

        int targetIndex = findTarget(decoded);
        if (targetIndex < 0) throw new IllegalArgumentException("target URL is missing");

        ProxyCommand command = new ProxyCommand();
        parseDirectives(decoded.substring(0, targetIndex), command);
        command.targetUrl = decoded.substring(targetIndex);
        if (!command.targetUrl.matches("^https?://[^/].*")) {
            throw new IllegalArgumentException("target URL is malformed");
        }
        return command;
    }

    private static int findTarget(String value) {
        int http = value.indexOf("http://");
        int https = value.indexOf("https://");
        if (http < 0) return https;
        if (https < 0) return http;
        return Math.min(http, https);
    }

    private static void parseDirectives(String directives, ProxyCommand command) throws Exception {
        String[] parts = directives.split("/", -1);
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i];
            if (part.isEmpty()) continue;
            if ("cookie_plus".equals(part)) {
                command.cookiePlus = true;
            } else if ("get_cookie".equals(part)) {
                command.cookie = true;
            } else if ("get_redirect".equals(part)) {
                command.getRedirect = true;
            } else if ("head".equals(part)) {
                command.forceHead = true;
            } else if (part.startsWith("redirect=")) {
                command.redirectMode = URLDecoder.decode(part.substring("redirect=".length()), "UTF-8");
            } else if ("param".equals(part) && i + 1 < parts.length) {
                String value = parts[++i];
                int equals = value.indexOf('=');
                if (equals < 0) continue;
                String key = URLDecoder.decode(value.substring(0, equals), "UTF-8");
                String headerValue = URLDecoder.decode(value.substring(equals + 1), "UTF-8");
                if (!key.isEmpty()) command.headers.put(key, headerValue);
            }
        }
    }
}
