package ru.malanchuk.lampabridge.network;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class UpstreamResponse {
    public int statusCode;
    public String currentUrl;
    public byte[] body = new byte[0];
    public final Map<String, String> headers = new LinkedHashMap<>();
    public final List<String> cookies = new ArrayList<>();
}
