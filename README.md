# Rodzinne zadania

Prywatna aplikacja na Androida: rodzice przydzielają zadania, dzieci zgłaszają wykonanie, rodzic zatwierdza po sprawdzeniu w realu. Punkty, serie, sklep z nagrodami i kolekcja naklejek.

- `apps/api`: Cloudflare Worker (Hono, D1, R2, cron, FCM)
- `apps/mobile`: SvelteKit (build statyczny) i Capacitor (Android)
- `packages/core`: logika: daty w strefie rodziny, powtarzanie (RRULE), seria, losowanie, godziny ciszy
- `packages/shared`: schematy i typy API
- `packages/seed`: generator wbudowanych paczek naklejek, awatarów i ramek

Dokumentacja: [docs/setup.md](docs/setup.md) (uruchomienie i wdrożenie), [docs/decisions.md](docs/decisions.md) (doprecyzowania specyfikacji).
