-- The sideloaded app downloads updates itself and checks the file before
-- installing: expected size in bytes and SHA-256 (hex) of the APK. Both are
-- filled by scripts/release-apk.sh; older rows fall back to the R2 object size.
ALTER TABLE app_release ADD COLUMN apk_size INTEGER;
ALTER TABLE app_release ADD COLUMN apk_sha256 TEXT;
