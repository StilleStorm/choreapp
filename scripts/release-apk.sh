#!/usr/bin/env bash
# Builds a signed release APK, uploads it to R2 and registers it, so every
# phone in the family sees "Nowa wersja aplikacji".
# Usage: scripts/release-apk.sh "Krótki opis zmian"
# Needs: apps/mobile/.env.production (VITE_API_URL), android/keystore.properties,
#        ANDROID_HOME with the Android SDK, `wrangler login` done.
set -euo pipefail
cd "$(dirname "$0")/.."
notes="${1:-}"

gradle=apps/mobile/android/app/build.gradle
code=$(grep -oP 'versionCode \K\d+' "$gradle")
name=$(grep -oP 'versionName "\K[^"]+' "$gradle")
echo "Building ${name} (${code})"

(cd apps/mobile && pnpm exec vite build --mode production && pnpm exec cap sync android)
(cd apps/mobile/android && ./gradlew --quiet assembleRelease)
apk=apps/mobile/android/app/build/outputs/apk/release/app-release.apk
[ -f "$apk" ] || { echo "APK not found (is keystore.properties set up?)"; exit 1; }

key="releases/choreapp-${code}.apk"
(cd apps/api && pnpm exec wrangler r2 object put "choreapp-files/${key}" --file "../../${apk}" --content-type application/vnd.android.package-archive --remote)
esc=${notes//\'/\'\'}
(cd apps/api && pnpm exec wrangler d1 execute choreapp --remote --command \
  "INSERT INTO app_release (version_code, version_name, apk_key, notes, created_at) VALUES (${code}, '${name}', '${key}', '${esc}', $(date +%s)000)
   ON CONFLICT(version_code) DO UPDATE SET version_name = excluded.version_name, apk_key = excluded.apk_key, notes = excluded.notes")
cp "$apk" "choreapp-${name}.apk"
echo "Done: choreapp-${name}.apk (also on R2 as ${key})"
