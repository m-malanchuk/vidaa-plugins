package ru.malanchuk.lampabridge.protocol;

import java.util.LinkedHashMap;
import java.util.Map;

public final class ProxyCommand {
    public String targetUrl;
    public boolean cookie;
    public boolean cookiePlus;
    public boolean getRedirect;
    public boolean forceHead;
    public String redirectMode;
    public final Map<String, String> headers = new LinkedHashMap<>();
}
