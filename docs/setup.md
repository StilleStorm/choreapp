# Uruchomienie i wdrożenie

Wszystko mieści się w darmowym planie Cloudflare (Workers Free, D1, R2, statyczne assety).

## Wymagania

- Node 24+ i pnpm (`npm i -g pnpm`), potem `pnpm install` w katalogu głównym.
- Konto Cloudflare: `pnpm --filter @choreapp/api exec wrangler login`.
- Projekt Firebase (tylko do powiadomień push).
- Android SDK (`ANDROID_HOME`) i JDK 21 do zbudowania APK.

## 1. Backend (Cloudflare)

```bash
cd apps/api
pnpm exec wrangler d1 create choreapp          # wpisz zwrócone database_id do wrangler.jsonc
pnpm exec wrangler r2 bucket create choreapp-files
pnpm run db:migrate:remote
pnpm run db:seed:remote                        # wbudowane paczki: 397 naklejek, 60 awatarów, 25 ramek
pnpm exec wrangler secret put FILE_SIGNING_KEY # dowolny długi losowy ciąg
pnpm exec wrangler secret put FCM_SERVICE_ACCOUNT   # JSON konta serwisowego Firebase w jednej linii
pnpm exec wrangler email sending enable stillestormstudio.com   # domena nadawcy maili z kodami do zmiany hasła
pnpm run deploy
```

Maile z kodami do zmiany hasła (tylko dorośli) idą przez Cloudflare Email Sending z bindingu `EMAIL`. Domena nadawcy musi mieć włączone Email Sending (`wrangler email sending enable <domena>`, rekordy DKIM/SPF dodaje Cloudflare). Wysyłka do dowolnych adresatów wymaga planu Workers Paid; na planie Free maile dochodzą tylko na zweryfikowane adresy (błąd `recipient_plan_restricted`). Gdy wysyłka się nie uda, API i tak odpowiada 200 (błąd trafia do logów Workera), a zapasową drogą zostaje kod resetu od administratora rodziny.

Adres Workera (np. `https://choreapp-api.<subdomena>.workers.dev`) wpisz do `apps/mobile/.env.production`:

```
VITE_API_URL=https://choreapp-api.<subdomena>.workers.dev
```

## 2. Firebase (push)

1. W konsoli Firebase utwórz projekt i dodaj aplikację Android o identyfikatorze `app.choreapp.family`.
2. Pobierz `google-services.json` do `apps/mobile/android/app/` (plik jest w `.gitignore`).
3. Ustawienia projektu → Konta usługi → „Wygeneruj nowy klucz prywatny”. Zawartość pliku zapisz jako sekret `FCM_SERVICE_ACCOUNT`.

Bez Firebase aplikacja działa normalnie, tylko bez powiadomień.

## 3. APK

Jednorazowo utwórz klucz do podpisywania (trzymaj go poza repo i zrób kopię, bez niego nie zaktualizujesz aplikacji na telefonach):

```bash
keytool -genkeypair -v -keystore ~/choreapp-release.jks -alias choreapp -keyalg RSA -keysize 4096 -validity 10000
```

`apps/mobile/android/keystore.properties`:

```
storeFile=/home/<ty>/choreapp-release.jks
storePassword=...
keyAlias=choreapp
keyPassword=...
```

Wydanie (podbij najpierw `versionCode` i `versionName` w `apps/mobile/android/app/build.gradle`):

```bash
scripts/release-apk.sh "Co nowego"
```

Skrypt buduje podpisany APK, wysyła go do R2 i rejestruje wersję. Telefony w rodzinie pokażą „Nowa wersja aplikacji”. Plik APK ląduje też w katalogu głównym, żeby zainstalować go pierwszy raz (przesłać na telefon, otworzyć, zezwolić na instalację z tego źródła).

## 4. Google Play (AAB)

```bash
cd apps/mobile && pnpm run aab
```

Buduje wersję bez samodzielnych aktualizacji (`VITE_DISTRIBUTION=play`) i podpisany pakiet `android/app/build/outputs/bundle/release/app-release.aab` (tym samym kluczem z `keystore.properties`; w Play Console można go zarejestrować jako klucz przesyłania). W Play Console podaj politykę prywatności `https://<adres Workera>/privacy` i stronę usuwania konta `https://<adres Workera>/delete-account`.

## Zdjęcia dzieci (migracja 0007, wersja 1.0.9)

Dzieci mają już tylko awatary (zasady Google Play dla rodzin). Migracja `0007_child_photos_removed.sql` czyści odwołania do zdjęć dzieci w D1, ale pliki w R2 trzeba usunąć ręcznie, **przed** `db:migrate:remote` (potem klucze znikają z bazy):

```bash
cd apps/api
pnpm exec wrangler d1 execute choreapp --remote --json \
  --command "SELECT avatar_key FROM member WHERE role = 'child' AND avatar_key IS NOT NULL" \
  | node -e 'for (const r of JSON.parse(require("fs").readFileSync(0))[0].results) console.log(r.avatar_key)' \
  | while read -r key; do pnpm exec wrangler r2 object delete "choreapp-files/$key" --remote; done
pnpm run db:migrate:remote
```

Jeśli migracja poszła pierwsza: zdjęcia dzieci leżą w R2 pod `families/<rodzina>/avatars/<id dziecka>-*` (lista w panelu Cloudflare → R2).

## Praca lokalna

```bash
cd apps/api && cp .dev.vars.example .dev.vars && pnpm run db:migrate:local && pnpm run db:seed:local && pnpm run dev
cd apps/mobile && pnpm run dev       # http://localhost:5173, API z VITE_API_URL (domyślnie http://localhost:8787)
pnpm test                            # wszystkie testy
```

## Odtwarzanie danych

- Paczki wbudowane: `pnpm --filter @choreapp/seed build` (pobiera Fluent Emoji z GitHuba, generuje awatary DiceBear i ramki), potem `db:seed:*`.
- Motywy i fonty: `node apps/mobile/scripts/gen-themes.mjs` (z `packages/seed/themes.json`, czyli tokenów odczytanych z mockupów).
