package com.onelineart.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.annotation.RequiresApi;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

/**
 * Saves and shares finished exports (PNG/JPEG/MP4/WebM) made by the web app.
 *
 * The web side streams the file in base64 chunks into the app cache
 * (begin/append). From there it is copied into the shared media collection
 * (MediaStore: Pictures/One Line Art, Movies/One Line Art) or shared through
 * the FileProvider with the system share sheet. Android 10+ needs no
 * permission for this; Android 7–9 needs WRITE_EXTERNAL_STORAGE (declared
 * with maxSdkVersion 28).
 *
 * Other files (the ".onelineart" project file) can be saved where the user
 * chooses: saveAs opens the system file dialog (ACTION_CREATE_DOCUMENT, no
 * permission needed) and copies the same cached file there.
 */
@CapacitorPlugin(
    name = "MediaExport",
    permissions = { @Permission(alias = MediaExportPlugin.LEGACY_STORAGE, strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) }
)
public class MediaExportPlugin extends Plugin {

    static final String LEGACY_STORAGE = "legacyStorage";
    private static final String CACHE_DIR = "exports";
    private static final String ALBUM = "One Line Art";
    /** Cached exports older than this are removed (shared files must outlive the share sheet). */
    private static final long MAX_CACHE_AGE_MS = 24L * 60 * 60 * 1000;
    private static final int COPY_BUFFER = 64 * 1024;

    private File exportsDir() {
        File dir = new File(getContext().getCacheDir(), CACHE_DIR);
        if (!dir.exists() && !dir.mkdirs()) return null;
        return dir;
    }

    /** The single file inside the export's own folder, or null. */
    private File fileFor(String id) {
        File root = exportsDir();
        if (root == null || id == null || id.contains("/") || id.contains("..")) return null;
        File[] files = new File(root, id).listFiles();
        return files != null && files.length == 1 ? files[0] : null;
    }

    private void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private void removeOldExports() {
        File root = exportsDir();
        File[] entries = root == null ? null : root.listFiles();
        if (entries == null) return;
        long now = System.currentTimeMillis();
        for (File entry : entries) if (now - entry.lastModified() > MAX_CACHE_AGE_MS) deleteRecursively(entry);
    }

    @PluginMethod
    public void begin(PluginCall call) {
        String requested = call.getString("fileName");
        if (requested == null || requested.isEmpty()) {
            call.reject("fileName is required");
            return;
        }
        removeOldExports();
        File root = exportsDir();
        if (root == null) {
            call.reject("No cache directory");
            return;
        }
        String id = UUID.randomUUID().toString();
        File dir = new File(root, id);
        // getName(): never a path from the web side.
        File file = new File(dir, new File(requested).getName());
        try {
            if (!dir.mkdirs() || !file.createNewFile()) throw new IOException("Cannot create " + file);
        } catch (IOException e) {
            call.reject("Cannot create the export file", e);
            return;
        }
        JSObject result = new JSObject();
        result.put("id", id);
        call.resolve(result);
    }

    @PluginMethod
    public void append(PluginCall call) {
        File file = fileFor(call.getString("id"));
        String data = call.getString("data");
        if (file == null || data == null) {
            call.reject("Unknown export or no data");
            return;
        }
        try (OutputStream out = new FileOutputStream(file, true)) {
            out.write(Base64.decode(data, Base64.DEFAULT));
            call.resolve();
        } catch (IOException | IllegalArgumentException e) {
            call.reject("Writing the export failed", e);
        }
    }

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState(LEGACY_STORAGE) != PermissionState.GRANTED) {
            requestPermissionForAlias(LEGACY_STORAGE, call, "legacyStorageCallback");
            return;
        }
        save(call);
    }

    @PermissionCallback
    private void legacyStorageCallback(PluginCall call) {
        if (getPermissionState(LEGACY_STORAGE) == PermissionState.GRANTED) save(call);
        else call.reject("Storage permission denied", "permission-denied");
    }

    private void save(PluginCall call) {
        File file = fileFor(call.getString("id"));
        String mimeType = call.getString("mimeType");
        boolean video = "video".equals(call.getString("kind"));
        if (file == null || mimeType == null) {
            call.reject("Unknown export");
            return;
        }
        String folder = video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES;
        try {
            Uri uri = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? saveWithMediaStore(file, mimeType, video, folder)
                : saveLegacy(file, mimeType, folder);
            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            result.put("location", (video ? "Filme" : "Bilder") + "/" + ALBUM);
            call.resolve(result);
        } catch (IOException | RuntimeException e) {
            call.reject("Saving to the gallery failed", e);
        }
    }

    /** Android 10+: scoped storage, no permission; the file is invisible until complete (IS_PENDING). */
    @RequiresApi(Build.VERSION_CODES.Q)
    private Uri saveWithMediaStore(File file, String mimeType, boolean video, String folder) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        Uri collection = video
            ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, file.getName());
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, folder + "/" + ALBUM);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = resolver.insert(collection, values);
        if (uri == null) throw new IOException("MediaStore insert failed");
        try (InputStream in = new FileInputStream(file); OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new IOException("No output stream");
            copy(in, out);
        } catch (IOException e) {
            resolver.delete(uri, null, null);
            throw e;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(uri, done, null, null);
        return uri;
    }

    /** Android 7–9: public Pictures/Movies folder, then the media scanner indexes it. */
    private Uri saveLegacy(File file, String mimeType, String folder) throws IOException {
        File dir = new File(Environment.getExternalStoragePublicDirectory(folder), ALBUM);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create " + dir);
        File target = new File(dir, file.getName());
        String base = file.getName();
        int dot = base.lastIndexOf('.');
        for (int i = 1; target.exists(); i++) {
            target = new File(dir, dot > 0 ? base.substring(0, dot) + " (" + i + ")" + base.substring(dot) : base + " (" + i + ")");
        }
        try (InputStream in = new FileInputStream(file); OutputStream out = new FileOutputStream(target)) {
            copy(in, out);
        }
        MediaScannerConnection.scanFile(getContext(), new String[] { target.getAbsolutePath() }, new String[] { mimeType }, null);
        return Uri.fromFile(target);
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[COPY_BUFFER];
        int read;
        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
    }

    @PluginMethod
    public void share(PluginCall call) {
        File file = fileFor(call.getString("id"));
        String mimeType = call.getString("mimeType");
        String title = call.getString("title", "");
        if (file == null || mimeType == null) {
            call.reject("Unknown export");
            return;
        }
        Context context = getContext();
        Uri uri;
        try {
            uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
        } catch (IllegalArgumentException e) {
            call.reject("File cannot be shared", e);
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mimeType);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.setClipData(ClipData.newRawUri(title, uri));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(send, title);
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(chooser);
                call.resolve();
            } catch (RuntimeException e) {
                call.reject("No app to share with", e);
            }
        });
    }

    /** Opens the system "save as" dialog (place and name chosen by the user) for the cached file. */
    @PluginMethod
    public void saveAs(PluginCall call) {
        File file = fileFor(call.getString("id"));
        String mimeType = call.getString("mimeType");
        if (file == null || mimeType == null) {
            call.reject("Unknown export");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        // Suggested name (the safe export name, with its extension).
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("fileName", file.getName()));
        try {
            startActivityForResult(call, intent, "saveAsResult");
        } catch (RuntimeException e) {
            call.reject("No file dialog available", e);
        }
    }

    @ActivityCallback
    private void saveAsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject answer = new JSObject();
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        // Closed without choosing a place: not an error.
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            answer.put("saved", false);
            call.resolve(answer);
            return;
        }
        File file = fileFor(call.getString("id"));
        if (file == null) {
            call.reject("Unknown export");
            return;
        }
        try (InputStream in = new FileInputStream(file); OutputStream out = getContext().getContentResolver().openOutputStream(uri, "w")) {
            if (out == null) throw new IOException("No output stream");
            copy(in, out);
        } catch (IOException | RuntimeException e) {
            call.reject("Saving the file failed", e);
            return;
        }
        answer.put("saved", true);
        answer.put("uri", uri.toString());
        call.resolve(answer);
    }

    @PluginMethod
    public void discard(PluginCall call) {
        File file = fileFor(call.getString("id"));
        if (file != null) deleteRecursively(file.getParentFile());
        call.resolve();
    }
}
