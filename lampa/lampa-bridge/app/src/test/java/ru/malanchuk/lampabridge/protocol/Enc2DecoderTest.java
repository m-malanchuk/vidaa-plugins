package ru.malanchuk.lampabridge.protocol;

import org.junit.Test;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public final class Enc2DecoderTest {
    @Test
    public void decodesHeadersCookiesAndRedirectFlags() throws Exception {
        String command = "param/Origin=" + encode("https://rezka.ag")
                + "/param/Referer=" + encode("https://rezka.ag/")
                + "/param/User-Agent=" + encode("Mozilla/5.0")
                + "/param/Cookie=" + encode("PHPSESSID=test; token=abc")
                + "/cookie_plus/get_redirect/https://rezka.ag/films/drama/36990-aferistka-2020.html";
        String encoded = Base64.getEncoder().encodeToString(command.getBytes(StandardCharsets.UTF_8));

        ProxyCommand result = Enc2Decoder.decode("/enc2/" + URLEncoder.encode(encoded, "UTF-8") + "/36990-aferistka-2020.html?jacred.test");

        assertEquals("https://rezka.ag/films/drama/36990-aferistka-2020.html", result.targetUrl);
        assertEquals("https://rezka.ag", result.headers.get("Origin"));
        assertEquals("https://rezka.ag/", result.headers.get("Referer"));
        assertEquals("Mozilla/5.0", result.headers.get("User-Agent"));
        assertEquals("PHPSESSID=test; token=abc", result.headers.get("Cookie"));
        assertTrue(result.cookiePlus);
        assertTrue(result.getRedirect);
    }

    private static String encode(String value) throws Exception {
        return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
    }
}
