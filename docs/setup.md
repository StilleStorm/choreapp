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
pnpm run db:seed:remote                        # wbudowane paczki: 397 naklejek, 60 awatarów, 150 awatarów motywów, 25 ramek
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

Buduje wersję bez samodzielnych aktualizacji (`VITE_DISTRIBUTION=play`), z linkiem „Postaw twórcy kawę” w ustawieniach rodzica (`VITE_SHOW_SUPPORT=1`) i podpisany pakiet `android/app/build/outputs/bundle/release/app-release.aab` (tym samym kluczem z `keystore.properties`; w Play Console można go zarejestrować jako klucz przesyłania). W Play Console podaj politykę prywatności `https://<adres Workera>/privacy` i stronę usuwania konta `https://<adres Workera>/delete-account`.

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

## Awatary motywów (migracja 0008)

150 ilustrowanych awatarów (6 na każdy z 25 motywów), darmowych dla dzieci i dorosłych. Pliki WebP 256 px (razem ok. 2,9 MB) są statycznymi assetami Workera (`apps/api/public/builtin/theme-avatars/`), tak jak awatary DiceBear, więc nie trafiają do R2 ani do APK. Źródła: `packages/seed/theme-avatars/*.webp` (z oryginałów PNG robi je `python3 -I packages/seed/theme-avatars.py <katalog z PNG> packages/seed/theme-avatars`). Kolejność ma znaczenie, bo seed wpisuje nową kolumnę `item.theme`:

```bash
cd apps/api
pnpm run db:migrate:remote   # 0008_theme_avatars.sql: kolumna item.theme
pnpm run db:seed:remote      # paczka „Awatary motywów” i 150 pozycji
pnpm run deploy              # wysyła pliki WebP (assety) i nowy kod API
```

## Naklejki WebP i cache obrazków (migracja 0009)

Naklejki są rastrami WebP 192 px (ok. 4 KB każda, razem 1,7 MB zamiast 6,2 MB SVG), bo złożone SVG Fluent Emoji zacinały siatki na Androidzie. `apps/api/public/_headers` daje `/builtin/*` cache na rok (`immutable`). **Zasada:** plik wbudowany nigdy nie zmienia treści pod tą samą nazwą; nowa lub poprawiona grafika dostaje nową nazwę (i nowy `image_key`). Kolejność:

```bash
cd apps/api
pnpm run deploy              # najpierw: assety mają i .webp, i stare .svg (stare zostają na jedno wydanie)
pnpm run db:migrate:remote   # 0009_sticker_webp.sql: image_key naklejek .svg -> .webp
pnpm run db:seed:remote      # te same klucze (seed jest idempotentny)
```

## Zestawy naklejek (migracja 0010, wersja 1.0.15)

20 autorskich zestawów (200 naklejek WebP pod `builtin/stickers/<zestaw>/`), każdy jako wbudowana paczka `builtin-set-<zestaw>`. Wersja 1.0.15 zawiera też 0009 (powyżej), więc przy aktualizacji z 1.0.14 kolejność jest jedna dla obu:

```bash
cd apps/api
pnpm run deploy              # 1. Worker z nowymi assetami (.webp naklejek i zestawów)
pnpm run db:migrate:remote   # 2. 0009 (image_key .svg -> .webp) i 0010 (nowe paczki włączone dla wszystkich rodzin)
pnpm run db:seed:remote      # 3. paczki i pozycje zestawów (seed jest idempotentny)
```

Oryginały PNG 1024 px (poza repo) leżą w `~/choreapp-assets/sticker-sets-png/`.

## Kilka urządzeń dziecka (migracja 0011, wersja 1.0.16)

`0011_child_devices.sql` dodaje `session.kind` (`device` / `swap`) i `invite.add_device`, a istniejące, niewylogowane sesje przełączenia (z telefonu dorosłego) oznacza jako `swap`: najstarsza żywa sesja dziecka to jego telefon (dotąd każdy nowy kod wylogowywał resztę), nowsze bez tokenu push to przełączenia. Nowy kod API zapisuje i czyta te kolumny, więc **migracja idzie pierwsza**:

```bash
cd apps/api
pnpm run db:migrate:remote   # 1. 0011 (kolumny z wartościami domyślnymi; stary Worker dalej działa)
pnpm run deploy              # 2. Worker z POST /v1/members, add_device i liczeniem urządzeń
```

Potem wydanie aplikacji 1.0.16. Starsze aplikacje dalej działają (kod bez `addDevice` = przeniesienie na nowy telefon, pole `connected` zostaje).

## Serwer testowy (staging)

Osobny Worker `choreapp-api-staging` z własną bazą D1 `choreapp-staging` i kubełkiem R2 `choreapp-files-staging` (`env.staging` w `wrangler.jsonc`, bez crona: przypomnienia dzienne i zbiorcze po godzinach ciszy tam nie chodzą). Produkcja zostaje nietknięta. Jednorazowo:

```bash
cd apps/api
pnpm exec wrangler d1 create choreapp-staging --location weur   # wpisz database_id do env.staging w wrangler.jsonc
pnpm exec wrangler r2 bucket create choreapp-files-staging
pnpm exec wrangler secret put FILE_SIGNING_KEY --env staging     # nowy losowy ciąg, inny niż produkcyjny
pnpm exec wrangler secret put FCM_SERVICE_ACCOUNT --env staging  # ten sam JSON konta serwisowego Firebase
```

Wdrożenie (ta sama kolejność co na produkcji) i rodzina demo:

```bash
pnpm run deploy:staging && pnpm run db:migrate:staging && pnpm run db:seed:staging
node ../../scripts/demo-family.mjs https://choreapp-api-staging.<subdomena>.workers.dev
```

Aplikacja testowa: `apps/mobile/.env.staging` z `VITE_API_URL=https://choreapp-api-staging.<subdomena>.workers.dev`, potem `cd apps/mobile && pnpm run apk:staging`. Powstaje podpisany APK `app.choreapp.family.staging` („Zadania TEST”), który instaluje się obok prawdziwej aplikacji, nigdy nie proponuje aktualizacji i pokazuje link „Postaw twórcy kawę”. Push działa dopiero, gdy w Firebase dodasz aplikację Android `app.choreapp.family.staging` i pobierzesz nowy `google-services.json` (bez tego build testowy po prostu nie rejestruje powiadomień).

## Praca lokalna

```bash
cd apps/api && cp .dev.vars.example .dev.vars && pnpm run db:migrate:local && pnpm run db:seed:local && pnpm run dev
node scripts/demo-family.mjs http://localhost:8787   # rodzina demo: mama@example.com / haslo-12345, dzieci Zosia i Kuba
cd apps/mobile && pnpm run dev       # http://localhost:5173, API z VITE_API_URL (domyślnie http://localhost:8787)
pnpm test                            # wszystkie testy
```

## Odtwarzanie danych

- Paczki wbudowane: `pnpm --filter @choreapp/seed build` (pobiera Fluent Emoji z GitHuba, generuje awatary DiceBear i ramki, kopiuje awatary motywów, robi z naklejek WebP 192 px), potem `db:seed:*`. Nie zmieniaj treści istniejącego pliku pod tą samą nazwą (cache `immutable`, patrz migracja 0009).
- Ikony zadań w APK: `pnpm --filter @choreapp/seed task-icons` (SVG z `packages/seed/task-icons/` -> WebP 192 px w `apps/mobile/static/icons/tasks/`).
- Motywy i fonty: `node apps/mobile/scripts/gen-themes.mjs` (z `packages/seed/themes.json`, czyli tokenów odczytanych z mockupów).
