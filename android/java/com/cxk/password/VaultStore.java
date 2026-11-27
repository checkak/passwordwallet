//
//  VaultStore.java
//  密码卡包 Android — AES-256-CBC + HMAC-SHA256 加密存储，主密钥由 AndroidKeyStore 包裹
//
package com.cxk.password;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

public final class VaultStore {

    private static final String PREFS = "pw";
    private static final String VAULT_FILE = "vault.bin";
    private static final String KEY_ALIAS = "pw_wrap";
    private static final byte[] MAGIC = {'P', 'W', 'V', '1'};
    private static final int PBKDF2_ROUNDS = 120000;
    private static final int KEY_LEN = 32;

    private static VaultStore sInstance;

    private final Context ctx;
    private byte[] masterKey;

    private VaultStore(Context c) {
        ctx = c.getApplicationContext();
    }

    public static synchronized VaultStore get(Context c) {
        if (sInstance == null) sInstance = new VaultStore(c);
        return sInstance;
    }

    /* ---------------- 主密钥 ---------------- */

    private SecretKey wrapKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }

    private byte[] masterKey() throws Exception {
        if (masterKey != null) return masterKey;
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String wrapped = sp.getString("wrap", null);

        if (wrapped != null) {
            String[] parts = wrapped.split(":");
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] ct = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, wrapKey(), new GCMParameterSpec(128, iv));
            masterKey = c.doFinal(ct);
            return masterKey;
        }

        // KeyStore 不可用时退回应用私有目录（仍是沙箱内，兜底不阻断使用）
        File fallback = new File(ctx.getFilesDir(), ".mk");
        if (fallback.exists()) {
            byte[] k = readFile(fallback);
            if (k != null && k.length == KEY_LEN) {
                masterKey = k;
                return masterKey;
            }
        }

        byte[] fresh = new byte[KEY_LEN];
        new SecureRandom().nextBytes(fresh);
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, wrapKey());
            byte[] iv = c.getIV();
            byte[] ct = c.doFinal(fresh);
            sp.edit()
              .putString("wrap", Base64.encodeToString(iv, Base64.NO_WRAP) + ":"
                      + Base64.encodeToString(ct, Base64.NO_WRAP))
              .apply();
        } catch (Exception e) {
            FileOutputStream fos = new FileOutputStream(fallback);
            fos.write(fresh);
            fos.close();
        }
        masterKey = fresh;
        return masterKey;
    }

    /* ---------------- 加解密 ---------------- */

    private byte[] macKey(byte[] key) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("PWV1-mac".getBytes("UTF-8"), "HmacSHA256"));
        return mac.doFinal(key);
    }

    private byte[] encrypt(byte[] plain) throws Exception {
        byte[] key = masterKey();
        byte[] iv = new byte[16];
        new SecureRandom().nextBytes(iv);

        Cipher c = Cipher.getInstance("AES/CBC/PKCS5Padding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        byte[] ct = c.doFinal(plain);

        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.write(MAGIC);
        body.write(iv);
        body.write(ct);
        byte[] bodyBytes = body.toByteArray();

        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(macKey(key), "HmacSHA256"));
        byte[] tag = mac.doFinal(bodyBytes);

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(bodyBytes);
        out.write(tag);
        return out.toByteArray();
    }

    private byte[] decrypt(byte[] all) throws Exception {
        if (all == null || all.length < MAGIC.length + 16 + 32) return null;
        for (int i = 0; i < MAGIC.length; i++) {
            if (all[i] != MAGIC[i]) return null;
        }
        int bodyLen = all.length - 32;
        byte[] key = masterKey();

        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(macKey(key), "HmacSHA256"));
        mac.update(all, 0, bodyLen);
        byte[] expect = mac.doFinal();
        int diff = 0;
        for (int i = 0; i < 32; i++) diff |= (expect[i] ^ all[bodyLen + i]);
        if (diff != 0) return null;

        byte[] iv = new byte[16];
        System.arraycopy(all, MAGIC.length, iv, 0, 16);
        int ctLen = bodyLen - MAGIC.length - 16;
        byte[] ct = new byte[ctLen];
        System.arraycopy(all, MAGIC.length + 16, ct, 0, ctLen);

        Cipher c = Cipher.getInstance("AES/CBC/PKCS5Padding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        return c.doFinal(ct);
    }

    /* ---------------- 读写 ---------------- */

    public synchronized String load() {
        File f = new File(ctx.getFilesDir(), VAULT_FILE);
        if (!f.exists()) return null;
        try {
            byte[] plain = decrypt(readFile(f));
            if (plain == null) return null;
            return new String(plain, "UTF-8");
        } catch (Exception e) {
            return null;
        }
    }

    public synchronized boolean save(String json) {
        if (json == null) return false;
        try {
            byte[] payload = encrypt(json.getBytes("UTF-8"));
            File tmp = new File(ctx.getFilesDir(), VAULT_FILE + ".tmp");
            FileOutputStream fos = new FileOutputStream(tmp);
            fos.write(payload);
            fos.getFD().sync();
            fos.close();
            File dest = new File(ctx.getFilesDir(), VAULT_FILE);
            return tmp.renameTo(dest) || copyOver(tmp, dest);
        } catch (Exception e) {
            return false;
        }
    }

    private boolean copyOver(File from, File to) {
        try {
            FileOutputStream out = new FileOutputStream(to);
            byte[] data = readFile(from);
            out.write(data);
            out.close();
            from.delete();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private byte[] readFile(File f) {
        try {
            FileInputStream in = new FileInputStream(f);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            in.close();
            return bos.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    /* ---------------- 主密码 ---------------- */

    private byte[] pbkdf2(String code, byte[] salt, int rounds) throws Exception {
        String algo = "PBKDF2WithHmacSHA256";
        try {
            SecretKeyFactory.getInstance(algo);
        } catch (Exception e) {
            algo = "PBKDF2WithHmacSHA1";
        }
        SecretKeyFactory f = SecretKeyFactory.getInstance(algo);
        PBEKeySpec spec = new PBEKeySpec(code.toCharArray(), salt, rounds, KEY_LEN * 8);
        return f.generateSecret(spec).getEncoded();
    }

    public boolean hasPasscode() {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("pc", null) != null;
    }

    public boolean setPasscode(String code) {
        if (code == null || code.length() < 4) return false;
        try {
            byte[] salt = new byte[16];
            new SecureRandom().nextBytes(salt);
            byte[] hash = pbkdf2(code, salt, PBKDF2_ROUNDS);
            String record = Base64.encodeToString(salt, Base64.NO_WRAP) + ":"
                    + Base64.encodeToString(hash, Base64.NO_WRAP) + ":" + PBKDF2_ROUNDS;
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("pc", record).apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public boolean verifyPasscode(String code) {
        String record = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("pc", null);
        if (record == null || code == null) return false;
        try {
            String[] p = record.split(":");
            byte[] salt = Base64.decode(p[0], Base64.NO_WRAP);
            byte[] expect = Base64.decode(p[1], Base64.NO_WRAP);
            int rounds = Integer.parseInt(p[2]);
            byte[] hash = pbkdf2(code, salt, rounds);
            int diff = 0;
            for (int i = 0; i < expect.length; i++) diff |= (expect[i] ^ hash[i]);
            return diff == 0;
        } catch (Exception e) {
            return false;
        }
    }

    public void clearPasscode() {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("pc").apply();
    }
}
