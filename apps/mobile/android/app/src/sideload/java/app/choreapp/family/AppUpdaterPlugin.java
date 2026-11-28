package app.choreapp.family;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Self-update of the sideloaded APK (never part of the Google Play build):
 * downloads the release into the app's cache, checks size, SHA-256 and package
 * name, then hands it to the Android system installer. No browser, no links out.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String DIR = "updates";
    private static final String FILE = "update.apk";
    private static final long MAX_BYTES = 200L * 1024 * 1024;
    private volatile boolean downloading = false;

    private File apkFile() {
        return new File(new File(getContext().getCacheDir(), DIR), FILE);
    }

    private boolean installAllowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private boolean debuggable() {
        return (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", installAllowed());
        call.resolve(r);
    }

    /** The system screen "Install unknown apps" for this app (Android 8+). */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            try {
                getActivity().startActivity(i);
            } catch (Exception e) {
                getActivity().startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        final long expected = call.getData().optLong("size", 0);
        final String sha256 = call.getString("sha256");
        if (url == null || !(url.startsWith("https://") || (debuggable() && url.startsWith("http://")))) {
            call.reject("bad_url", "bad_url");
            return;
        }
        if (downloading) {
            call.reject("busy", "busy");
            return;
        }
        downloading = true;
        new Thread(() -> {
            try {
                JSObject result = fetch(url, expected, sha256);
                call.resolve(result);
            } catch (UpdateError e) {
                call.reject(e.getMessage(), e.getMessage());
            } catch (Exception e) {
                call.reject("network", "network", e);
            } finally {
                downloading = false;
            }
        }).start();
    }

    private JSObject fetch(String url, long expected, String sha256) throws Exception {
        File dir = new File(getContext().getCacheDir(), DIR);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdir");
        File part = new File(dir, FILE + ".part");
        File out = apkFile();
        part.delete();
        out.delete();

        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        try {
            int status = c.getResponseCode();
            if (status != 200) throw new UpdateError("http_" + status);
            long header = c.getContentLengthLong();
            long total = expected > 0 ? expected : header;
            if (expected > 0 && header > 0 && header != expected) throw new UpdateError("size_mismatch");
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long done = 0;
            long lastEmit = 0;
            try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) {
                    os.write(buf, 0, n);
                    md.update(buf, 0, n);
                    done += n;
                    if ((total > 0 && done > total) || done > MAX_BYTES) throw new UpdateError("size_mismatch");
                    long now = SystemClock.uptimeMillis();
                    if (now - lastEmit > 200) {
                        lastEmit = now;
                        progress(done, total);
                    }
                }
            }
            progress(done, total);
            if (total > 0 && done != total) throw new UpdateError("size_mismatch");
            String hex = toHex(md.digest());
            if (sha256 != null && !sha256.isEmpty() && !sha256.equalsIgnoreCase(hex)) throw new UpdateError("checksum_mismatch");

            if (!part.renameTo(out)) throw new IOException("rename");
            // It must be an update of this very app.
            PackageInfo info = getContext().getPackageManager().getPackageArchiveInfo(out.getAbsolutePath(), 0);
            if (info == null || !getContext().getPackageName().equals(info.packageName)) {
                out.delete();
                throw new UpdateError("wrong_package");
            }

            JSObject r = new JSObject();
            r.put("size", done);
            r.put("sha256", hex);
            r.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode);
            return r;
        } catch (Exception e) {
            part.delete();
            throw e;
        } finally {
            c.disconnect();
        }
    }

    private void progress(long done, long total) {
        JSObject p = new JSObject();
        p.put("downloaded", done);
        p.put("total", total);
        notifyListeners("progress", p);
    }

    /** Opens the system installer for the downloaded file. */
    @PluginMethod
    public void install(PluginCall call) {
        File f = apkFile();
        if (!f.exists()) {
            call.reject("no_file", "no_file");
            return;
        }
        if (!installAllowed()) {
            call.reject("install_not_allowed", "install_not_allowed");
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("install_failed", "install_failed", e);
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static class UpdateError extends Exception {
        UpdateError(String code) {
            super(code);
        }
    }
}
