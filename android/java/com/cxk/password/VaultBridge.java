//
//  VaultBridge.java
//  密码卡包 Android — JS 桥：存储 / 剪贴板 / 触感 / 分享
//  协议与 iOS 完全一致：{id, method, params} → window.__bridgeReply(id, {ok, result|error})
//
package com.cxk.password;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

public class VaultBridge {

    private final Activity activity;
    private final WebView webView;
    private final VaultStore store;
    private final Handler main = new Handler(Looper.getMainLooper());

    public VaultBridge(Activity a, WebView w) {
        activity = a;
        webView = w;
        store = VaultStore.get(a);
    }

    @JavascriptInterface
    public void postMessage(final String raw) {
        new Thread(new Runnable() {
            @Override public void run() {
                String id = "";
                String payload;
                try {
                    JSONObject in = new JSONObject(raw);
                    id = in.optString("id", "");
                    String method = in.optString("method", "");
                    JSONObject params = in.optJSONObject("params");
                    if (params == null) params = new JSONObject();
                    payload = handle(method, params);
                } catch (Exception e) {
                    payload = error("bridge failure: " + e.getClass().getSimpleName());
                }
                final String js = "window.__bridgeReply.apply(null,[" + JSONObject.quote(id) + "," + payload + "])";
                main.post(new Runnable() {
                    @Override public void run() {
                        try { webView.evaluateJavascript(js, null); } catch (Exception ignored) { }
                    }
                });
            }
        }, "pw-bridge").start();
    }

    private String ok(JSONObject result) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("result", result == null ? new JSONObject() : result);
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":true,\"result\":{}}";
        }
    }

    private String error(String message) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("error", message == null ? "error" : message);
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"error\"}";
        }
    }

    private String handle(String method, JSONObject params) {
        try {
            if ("vault.load".equals(method)) {
                String data = store.load();
                JSONObject r = new JSONObject();
                if (data != null) r.put("data", data);
                return ok(r);
            }

            if ("vault.save".equals(method)) {
                String data = params.optString("data", null);
                if (data == null) return error("bad data");
                if (!store.save(data)) return error("save failed");
                JSONObject r = new JSONObject();
                r.put("saved", true);
                return ok(r);
            }

            if ("passcode.has".equals(method)) {
                JSONObject r = new JSONObject();
                r.put("has", store.hasPasscode());
                return ok(r);
            }

            if ("passcode.set".equals(method)) {
                String code = params.optString("passcode", null);
                if (!store.setPasscode(code)) return error("passcode too short");
                JSONObject r = new JSONObject();
                r.put("set", true);
                return ok(r);
            }

            if ("passcode.verify".equals(method)) {
                JSONObject r = new JSONObject();
                r.put("ok", store.verifyPasscode(params.optString("passcode", null)));
                return ok(r);
            }

            if ("passcode.clear".equals(method)) {
                store.clearPasscode();
                return ok(null);
            }

            if ("clipboard.copy".equals(method)) {
                final String text = params.optString("text", "");
                final boolean sensitive = params.optBoolean("sensitive", false);
                main.post(new Runnable() {
                    @Override public void run() {
                        ClipboardManager cm = (ClipboardManager)
                                activity.getSystemService(Context.CLIPBOARD_SERVICE);
                        cm.setPrimaryClip(ClipData.newPlainText("密码卡包", text));
                        if (sensitive) scheduleClipboardClear(text);
                    }
                });
                JSONObject r = new JSONObject();
                r.put("copied", true);
                return ok(r);
            }

            if ("clipboard.read".equals(method)) {
                final String[] holder = new String[1];
                final Object lock = new Object();
                main.post(new Runnable() {
                    @Override public void run() {
                        ClipboardManager cm = (ClipboardManager)
                                activity.getSystemService(Context.CLIPBOARD_SERVICE);
                        if (cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
                            CharSequence cs = cm.getPrimaryClip().getItemAt(0).coerceToText(activity);
                            holder[0] = cs == null ? null : cs.toString();
                        }
                        synchronized (lock) { lock.notifyAll(); }
                    }
                });
                synchronized (lock) {
                    try { lock.wait(1200); } catch (InterruptedException ignored) { }
                }
                JSONObject r = new JSONObject();
                if (holder[0] != null) r.put("text", holder[0]);
                return ok(r);
            }

            if ("haptic".equals(method)) {
                final String type = params.optString("type", "light");
                main.post(new Runnable() {
                    @Override public void run() {
                        try {
                            Vibrator v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
                            if (v == null || !v.hasVibrator()) return;
                            int ms = "heavy".equals(type) ? 24 : ("medium".equals(type) ? 14 : 8);
                            if (Build.VERSION.SDK_INT >= 26) {
                                v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                            } else {
                                v.vibrate(ms);
                            }
                        } catch (Exception ignored) { }
                    }
                });
                return ok(null);
            }

            if ("share.text".equals(method)) {
                final String text = params.optString("text", "");
                main.post(new Runnable() {
                    @Override public void run() {
                        Intent send = new Intent(Intent.ACTION_SEND);
                        send.setType("text/plain");
                        send.putExtra(Intent.EXTRA_TEXT, text);
                        Intent chooser = Intent.createChooser(send, "导出备份");
                        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        activity.startActivity(chooser);
                    }
                });
                JSONObject r = new JSONObject();
                r.put("presented", true);
                return ok(r);
            }

            if ("http.get".equals(method)) {
                String url = params.optString("url", null);
                if (url == null || url.isEmpty()) return error("bad url");
                java.net.HttpURLConnection conn = null;
                try {
                    conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                    conn.setConnectTimeout(5000);
                    conn.setReadTimeout(5000);
                    conn.setRequestProperty("Accept", "application/json");
                    conn.setRequestProperty("Cache-Control", "no-cache");
                    conn.setRequestProperty("User-Agent", "PasswordWallet/0.8 (Android)");
                    int code = conn.getResponseCode();
                    java.io.InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                    if (is != null) {
                        byte[] buf = new byte[4096];
                        int n;
                        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
                        is.close();
                    }
                    JSONObject r = new JSONObject();
                    r.put("status", code);
                    r.put("body", new String(bos.toByteArray(), "UTF-8"));
                    return ok(r);
                } catch (Exception e) {
                    return error("network: " + e.getClass().getSimpleName());
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }

            if ("app.info".equals(method)) {
                JSONObject r = new JSONObject();
                r.put("version", "0.8");
                r.put("build", "8");
                r.put("platform", "android");
                return ok(r);
            }

            return error("unknown method " + method);
        } catch (Exception e) {
            return error(e.getClass().getSimpleName());
        }
    }

    private void scheduleClipboardClear(final String snapshot) {
        main.postDelayed(new Runnable() {
            @Override public void run() {
                try {
                    ClipboardManager cm = (ClipboardManager)
                            activity.getSystemService(Context.CLIPBOARD_SERVICE);
                    if (!cm.hasPrimaryClip() || cm.getPrimaryClip().getItemCount() == 0) return;
                    CharSequence cur = cm.getPrimaryClip().getItemAt(0).coerceToText(activity);
                    if (cur != null && snapshot.contentEquals(cur)) {
                        cm.setPrimaryClip(ClipData.newPlainText("", ""));
                    }
                } catch (Exception ignored) { }
            }
        }, 60000);
    }
}
