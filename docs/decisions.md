# Decyzje i doprecyzowania

Specyfikacja: https://claude.ai/artifact/SK3JoeQcavgGKoMuXnsXkS. Poniżej to, czego nie rozstrzygała, i jak to zrobiono.

## Konta

- Dziecko nie ma e-maila ani hasła. Dołącza kodem QR albo 6 cyframi od rodzica (jednorazowe, ważne 15 minut) i zostaje zalogowane na stałe. „Dodaj dziecko” pyta najpierw: „Ma swój telefon” (kod) albo „Nie ma telefonu”: wtedy dorosły wpisuje tylko pseudonim, serwer od razu tworzy profil bez żadnej sesji (`POST /v1/members`, każdy dorosły rodziny, te same domyślne ustawienia co przy kodzie, wspólna funkcja `insertMember`), a arkusz proponuje „Przełącz teraz” (konto dziecka na telefonie dorosłego).
- Przed zgadywaniem kodów chronią trzy limity (1.0.7):
  - 10 błędnych prób (kod albo link) z jednego adresu IP na 15 minut; jedynym zaufanym źródłem adresu jest nagłówek `CF-Connecting-IP`, który ustawia brzeg Cloudflare,
  - 6 cyfr nie mówi, w które zaproszenie ktoś celował, więc każdy błędny kod liczy się do wszystkich aktywnych zaproszeń (`invite.code_misses`). Po 20 błędnych kodach kod zaproszenia przestaje działać, a link z QR (256 losowych bitów) działa dalej. Atakujący z dowolną liczbą adresów ma więc najwyżej 20 prób na zaproszenie, czyli szansę około 1 na 50 000,
  - po 50 błędnych kodach z wszystkich adresów w 15 minut wpisywanie kodów jest wstrzymane do końca okna (odpowiedź 429; QR działa). To też ogranicza zapisy do D1 przy zalewie żądań.
  Koszt: ktoś złośliwy może na chwilę zablokować wpisywanie kodów wszystkim rodzinom. To akceptowalne w prywatnej aplikacji, bo QR działa, a nowy kod to jedno dotknięcie.
- Nowy kod zastępuje tylko wcześniejszy, nieużyty kod tej samej osoby do tego samego celu. Kody innych dorosłych zostają ważne. Arkusz z kodem pyta o swój kod (`GET /v1/invites/:id`: pending, used albo gone), więc pokazuje „Gotowe!” tylko po użyciu właśnie tego kodu. Zamknięcie arkusza unieważnia nieużyty kod (`DELETE /v1/invites/:id`, może to zrobić tylko jego autor albo administrator). Odliczanie liczy się od czasu serwera (`InviteDto.now`), więc zły zegar telefonu nie przeszkadza.
- Zalogowana osoba, która trafi na ekran powitalny, logowanie albo rejestrację (np. przyciskiem Wstecz), wraca do swojego ekranu głównego. Kolejny dom dziecko dodaje tylko przez Profil → „Dodaj kolejny dom” (`/join?add=1`) albo link z QR. Jeśli kod jest do rodziny, w której telefon już jest, aplikacja ostrzega, że powstanie nowy, pusty profil.
- Hasło rodzica: PBKDF2-SHA256, 50 tys. iteracji (około 6 ms, mieści się w limicie CPU planu Free). Liczba iteracji jest zapisana przy koncie, więc można ją podnieść; hash przelicza się wtedy przy logowaniu.
- Od dzieci nie zbieramy danych osobowych: bez e-maila i hasła, a zamiast imienia dowolna nazwa (może być pseudonim, aplikacja prosi, żeby nie wpisywać nazwiska). Dorośli podają imię.
- Dzieci mają tylko awatary i ramki z aplikacji, bez własnych zdjęć (zasady Google Play dla rodzin, 1.0.9). `PUT /v1/me/avatar` dla dziecka zwraca 403 `child_photo_not_allowed`, aplikacja nie pokazuje dziecku wyboru zdjęcia (ani dorosłemu przy profilu dziecka). Migracja `0007_child_photos_removed.sql` czyści dawne zdjęcia dzieci (profil wraca do domyślnego obrazka z inicjałami albo posiadanego awatara); pliki w R2 usuwa się ręcznie przed migracją (`docs/setup.md`). Dorośli dalej mogą dodać zdjęcie.
- Dziecko może mieć kilka urządzeń (wersja 1.0.16, migracja 0011). W profilu dziecka: „Dodaj kolejne urządzenie” (kod z `invite.add_device = 1`, pozostałe urządzenia zostają zalogowane) i „Przenieś na nowy telefon” (jak dawniej: wylogowuje wszystkie sesje dziecka, także przełączenia z telefonu dorosłego; gdy dziecko ma jakieś urządzenie, arkusz najpierw ostrzega, ile urządzeń zostanie wylogowanych). Punkty, naklejki i historia zawsze zostają. Kod bez flagi (starsze wersje aplikacji) działa jak przeniesienie. Ustawienia pokazują przy dziecku „Bez telefonu” / „1 urządzenie” / „2 urządzenia” / „5 urządzeń”: liczba niewylogowanych sesji `session.kind = 'device'`. Przełączenie dorosłego na konto dziecka tworzy sesję `kind = 'swap'`, która się nie liczy i nie rejestruje tokenu push (serwer ją pomija). Push idzie na wszystkie zarejestrowane urządzenia dziecka (wiersz `device` na parę token + członek, powiązany z sesją); wylogowanie sesji usuwa jej token, a wysyłka pomija tokeny sesji zakończonych.
- Telefon dziecka może należeć do kilku domów (np. dom mamy, dom taty, dziadkowie). W każdym domu dziecko jest osobnym członkiem z własnymi punktami, naklejkami, zadaniami, nazwą i motywem; między domami nic się nie łączy. Telefon trzyma listę sesji (`homes` w Preferences; stary pojedynczy token zamienia się w listę z jednym domem) i jedną aktywną. Profil → Domy: przełączanie, „Dodaj kolejny dom” (kod QR albo 6 cyfr od dorosłego z drugiego domu) i „Usuń ten dom z telefonu”. Ponowne dołączenie do tej samej rodziny zastępuje jej wpis. Gdy domów jest kilka, na górze ekranów dziecka widać nazwę aktywnego domu. Sesja odrzucona przez serwer (np. rodzic usunął dziecko) znika z listy. Token powiadomień jest rejestrowany w każdym domu (urządzenie jest unikalne dla pary token + członek), więc powiadomienia przychodzą ze wszystkich domów. Dorosły ma zawsze jeden dom.
- Dorosły sam zmienia swój e-mail i hasło w Ustawieniach → Konto (`POST /v1/me/email`, `POST /v1/me/password`). Obie zmiany wymagają obecnego hasła (limit 10 błędnych prób na 15 minut). Po zmianie hasła pozostałe telefony tej osoby są wylogowane, bieżący zostaje.
- Zajęty e-mail przy zmianie e-maila daje 409 `email_taken`, bo dorosły musi wiedzieć, że wpisał adres, którego nie może użyć. Serwer sprawdza go dopiero po poprawnym obecnym haśle i najwyżej 5 razy na godzinę na osobę, więc nie da się tak tanio sprawdzać, kto ma konto. Rejestracja też zwraca 409 i ma limit 10 na adres IP na godzinę. Logowanie i „Nie pamiętam hasła” nie zdradzają, czy konto istnieje.
- Reset hasła dla dorosłych przez e-mail: „Nie pamiętam hasła” wysyła 6-cyfrowy kod (ważny 15 minut, jednorazowy, 5 błędnych prób unieważnia kod; limit 3 prośby na e-mail na godzinę i 10 na IP na 15 minut). Odpowiedź nie zdradza, czy konto istnieje. Po zmianie hasła wszystkie telefony tej osoby są wylogowane. Nadawca „Zadania <noreply@stillestormstudio.com>”, odpowiedzi trafiają na hello@stillestormstudio.com. Dzieci nigdy nie podają e-maila. Kody resetu od administratora rodziny (Ustawienia) zostają jako zapasowa droga.
- Administrator rodziny to dorosły, który ją założył (jeden na rodzinę, `family.admin_member_id`), albo ten, komu przekazał rolę. Tylko on zmienia ustawienia rodziny, edytuje profile innych dorosłych, daje im kody resetu hasła i usuwa członków; jego samego nie da się usunąć, więc w rodzinie zawsze zostaje rodzic. Rolę przekazuje innemu dorosłemu tej rodziny (Ustawienia → Rodzice i opiekunowie → „Przekaż rolę administratora”, `POST /v1/family/admin` z `memberId` i hasłem). Rola dotyczy jednej rodziny: dorosły należy do jednej rodziny (jeden e-mail, jedno konto), a dziecko, nawet w kilku domach, nigdy nie jest administratorem, więc cel musi być dorosłym z tej samej rodziny (inaczej 404 albo 400 `admin_must_be_adult`). Pozostali dorośli mają resztę uprawnień: zadania, akceptacje, nagrody, paczki, sklep, zapraszanie dzieci i dorosłych, edycję dzieci i własnego profilu.
- Usuwanie kont (1.0.9, wymóg Google Play) naprawdę kasuje dane, nie tylko odbiera dostęp (`services/erase.ts`):
  - administrator usuwa dziecko albo dorosłego (Ustawienia → osoba → „Usuń z rodziny”, `DELETE /v1/members/:id`): znikają wiersze członka we wszystkich tabelach (punkty, naklejki, zgłoszenia, nagrody, sesje, urządzenia, kody, liczniki prób) i jego zdjęcie w R2,
  - dorosły usuwa własne konto (Ustawienia → Konto → „Usuń konto”, `POST /v1/me/delete`, wymaga hasła). Tam, gdzie był tylko wykonawcą (zaakceptował zgłoszenie, wydał nagrodę), odwołanie jest czyszczone, a założone przez niego zadania przechodzą na administratora, więc zadania dzieci zostają,
  - administrator usuwa całą rodzinę (`POST /v1/family/delete`, wymaga hasła): wszyscy członkowie, zadania, nagrody, paczki, ustawienia i wszystkie pliki z prefiksu `families/<id>/` w R2,
  - administrator, który chce usunąć tylko siebie, najpierw przekazuje rolę innemu dorosłemu. Arkusz usuwania daje mu wtedy wybór „Przekaż rolę administratora i usuń tylko moje konto” (aplikacja woła `POST /v1/family/admin`, potem `POST /v1/me/delete`; jego zadania przechodzą na nowego administratora) albo „Usuń całą rodzinę”. Jedyny dorosły może usunąć tylko całą rodzinę.
  - Strony publiczne Workera: `/privacy` (polityka prywatności) i `/delete-account` (jak usunąć konto, także e-mailem w ciągu 30 dni). Polityka jest linkowana z rejestracji i z „O aplikacji”.

## Dystrybucja

- Dwie wersje z tego samego kodu: APK do instalacji ręcznej (`pnpm apk`, `scripts/release-apk.sh`) sprawdza `/v1/app/latest` i pokazuje „Nowa wersja aplikacji”; wersja dla Google Play (`pnpm aab`, `VITE_DISTRIBUTION=play`, `VITE_SHOW_SUPPORT=1`) nigdy tego nie robi i nie ma linku „Wersja aplikacji”, bo Play zabrania aktualizacji spoza sklepu. Obie mają ten sam `versionCode`.

## Zadania

- Termin z godziną: po tej godzinie zadanie jest zaległe. Bez godziny: po końcu dnia (strefa rodziny, domyślnie Europe/Warsaw).
- RRULE: zapisywany jest podzbiór RFC 5545. „31. dnia miesiąca” to `BYMONTHDAY=28,29,30,31;BYSETPOS=-1`, czyli ostatni dzień w krótszych miesiącach.
- Edycja serii: obecna wersja kończy się wczoraj (albo dziś, jeśli dzisiejsze wystąpienie ma już zgłoszenie), a nowa wersja startuje z tym samym `series_id`. „Co N tygodni” zachowuje fazę. Jednorazowe zadanie można edytować, dopóki nikt go nie zgłosił.
- Usunięcie serii kasuje przyszłe i zaległe, niezrobione dni. Zrobione i oczekujące na sprawdzenie zostają.
- „Wystarczy jedno”: zatwierdzenie jednego dziecka zamyka zadanie pozostałym, także ich oczekujące zgłoszenia. Punkty dostaje tylko to dziecko. Dla pozostałych zadanie jest neutralne dla serii, chyba że nikt go nie zrobił w terminie: wtedy przerywa serię wszystkim przypisanym.
- Kolejka offline przyjmuje czas kliknięcia z telefonu, ale najwyżej sprzed 48 godzin.

## Punkty, seria, naklejki

- Seria w widoku liczy też zgłoszenia czekające na sprawdzenie. Paczki za serię są przyznawane tylko z zatwierdzonych dni („tryb ścisły”) i raz na serię. Po przerwaniu serii progi można zdobyć ponownie.
- „Pierwsze zatwierdzone zadanie dnia” liczy się według dnia zatwierdzenia.
- Losowane są tylko naklejki. Awatary i ramki są tylko w sklepie.
- Awatary motywów (150, po 6 na motyw) są darmowe: każdy, dziecko i dorosły, może je założyć bez kupowania (`item.theme` niepuste, `price` NULL, więc nie ma ich w sklepie ani w losowaniu, ani w kolekcji; lista `GET /v1/avatars/themes`). Wybór awatara pokazuje najpierw „Twój motyw”, potem awatary ze sklepu i ramki, potem pozostałe motywy. Rodzina może wyłączyć paczkę „Awatary motywów” jak każdą wbudowaną. Dołączanie dziecka nie ma kroku z awatarem, więc nowe dziecko dalej startuje z inicjałami.
- Brak rzadkiej albo legendarnej w puli: paczka za serię daje najlepszą dostępną rzadkość, a puste miejsca zamieniają się na 5 pkt.
- Ceny przedmiotów: `price = NULL` oznacza tylko losowanie, `0` cenę rodziny dla danej rzadkości (domyślnie 30/80/200, zmiana w Nagrodach), `>0` stałą cenę.
- Nagroda od rodzica: punkty schodzą przy wyborze. Rodzic oznacza ją jako wydaną albo anuluje, a anulowanie zwraca punkty wpisem w księdze. Zakupy są atomowe, saldo nie zejdzie poniżej zera.

## Paczki i licencje

- Pliki z R2 (zdjęcia, obrazki z paczek rodziny) są podawane przez podpisane adresy ważne 24–48 godzin (koniec doby w górę), z nagłówkami `Content-Security-Policy` (bez skryptów) i `nosniff`. Aplikacja dostaje świeże adresy z każdą odpowiedzią API i odświeża `/me` po powrocie po ponad 30 minutach. Zdjęcie usuniętego członka jest kasowane z R2, więc stary adres przestaje działać. Ryzyko szczątkowe: obrazek z paczki rodziny, którego adres ktoś skopiował, działa do wygaśnięcia adresu. Serwer nie sprawdza właściciela przy każdym pobraniu, bo kosztowałoby to odczyt D1 na każdy obrazek.
- Dorosły może sprawdzić sklep i kolekcję tylko członków swojej rodziny (`?member=` i `/members/:id/collection`). Obcy identyfikator daje 404.
- Wbudowane paczki (`family_id NULL`) leżą w statycznych assetach Workera: to backend, nie APK, i jest darmowe. Każda rodzina może je wyłączyć u siebie. Paczki dodane przez rodzica trafiają do R2.
- Źródła:
  - Fluent Emoji (Microsoft, MIT) dla naklejek oraz ikonek zadań i nagród,
  - DiceBear Lorelei, Notionists, Open Peeps, Pixel Art i Thumbs (CC0 1.0) dla awatarów,
  - awatary motywów: ilustracje wygenerowane na zlecenie Stille Storm Studio (OpenAI gpt-image-1.5), © Stille Storm Studio,
  - ramki narysowane w skrypcie („private”),
  - fonty z Google Fonts (OFL 1.1).
  Lista jest w aplikacji: „Licencje grafik”.

## Powiadomienia

- Jeden cron co 5 minut: generuje wystąpienia na 14 dni naprzód, wysyła przypomnienie (raz dziennie, tylko przy niezrobionych zadaniach) i dostarcza wstrzymane powiadomienia.
- W godzinach ciszy wszystko czeka. Po ich końcu każda osoba dostaje jedno zbiorcze powiadomienie. Gdy rodzic skróci albo wyłączy godziny ciszy, wstrzymane powiadomienia dostają nowy termin i wychodzą przy najbliższym cronie. „Od” równe „Do” oznacza brak ciszy, więc formularz tego nie przyjmuje.
- Token OAuth do FCM jest w pamięci podręcznej w D1 (około godziny). Nieważne tokeny urządzeń są usuwane.

## Wygląd

- 25 motywów z mockupów, dziecko wybiera w Profil → Wygląd aplikacji. Dorosły wybiera w Ustawienia → Konto → Wygląd aplikacji: domyślnie „Neutralny” (id `neutral`, tylko dla dorosłych) albo jeden z 25 poza guild, lanterns i detective (ciemna strona z jasnymi kartami: pola formularzy, przyciski i tytuły arkuszy poza kartami są tam nieczytelne; lista `ADULT_HIDDEN_THEMES` w `packages/shared`, wspólna dla aplikacji i API, które odrzuca te motywy dla dorosłych). Motyw jest zapisany na serwerze (member.theme), więc działa na każdym telefonie.
- Po sprawdzeniu ekranów dorosłych (listy, formularze, arkusze) poprawione tokeny: jasne `--surface-2` w manga, sport, comic oraz w kartach i arkuszach lanterns i detective, ciemniejszy kolor akcentu w sport, ducks, comic i na kartach w detective, jaśniejsze tła etykiet (`*-soft`).
- Poprawki kontrastu względem mockupów (guild, lanterns, detective, retro90, sport, monsters, comic): ciemniejsze kolory tekstu na jasnych kartach i nieco ciemniejsze tła przycisków, żeby spełnić WCAG AA.
- Napis na przycisku pochodzi z motywu. „Zrobiłem/Zrobiłam” dziecko wybiera samo.
