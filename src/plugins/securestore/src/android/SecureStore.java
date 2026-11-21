package com.nexvora.securestore;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONException;

/**
 * Secret storage for account tokens. Values are encrypted with a key held in the Android
 * Keystore. There is intentionally NO plaintext fallback: if encryption is unavailable the
 * call fails and the JS layer keeps the secret in memory only.
 */
public class SecureStore extends CordovaPlugin {
    private static final String PREFS = "nexvora_secure_store";
    private SharedPreferences prefs;

    private synchronized SharedPreferences prefs() throws Exception {
        if (prefs == null) {
            Context ctx = cordova.getContext();
            String alias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
            prefs = EncryptedSharedPreferences.create(
                    PREFS, alias, ctx,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        }
        return prefs;
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext cb) throws JSONException {
        final String key = args.optString(0, "");
        if (key.isEmpty() || key.length() > 200) {
            cb.error("Invalid key");
            return true;
        }
        switch (action) {
            case "get":
            case "set":
            case "remove":
                break;
            default:
                return false;
        }
        cordova.getThreadPool().execute(() -> {
            try {
                SharedPreferences p = prefs();
                if ("get".equals(action)) {
                    cb.success(p.getString(key, ""));
                } else if ("set".equals(action)) {
                    String value = args.optString(1, "");
                    if (value.isEmpty() || !p.edit().putString(key, value).commit()) {
                        cb.error("Could not store value");
                    } else {
                        cb.success();
                    }
                } else {
                    p.edit().remove(key).commit();
                    cb.success();
                }
            } catch (Exception e) {
                // Never include the key's value or exception details that could echo secrets.
                cb.error("Secure storage unavailable");
            }
        });
        return true;
    }
}
