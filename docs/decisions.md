# Decyzje i doprecyzowania

Specyfikacja: https://claude.ai/artifact/SK3JoeQcavgGKoMuXnsXkS. Poniżej to, czego nie rozstrzygała, i jak to zrobiono.

## Konta

- Dziecko nie ma e-maila ani hasła. Dołącza kodem QR albo 6 cyframi od rodzica (jednorazowe, ważne 15 minut) i zostaje zalogowane na stałe. Nowy kod do istniejącego profilu wylogowuje stary telefon.
- Przed zgadywaniem kodów chroni limit 10 błędnych prób z jednego adresu na 15 minut.
- Hasło rodzica: PBKDF2-SHA256, 50 tys. iteracji (około 6 ms, mieści się w limicie CPU planu Free). Liczba iteracji jest zapisana przy koncie, więc można ją podnieść; hash przelicza się wtedy przy logowaniu.
- Reset hasła bez e-maili: administrator rodziny generuje kod resetu dla innego dorosłego w Ustawieniach.
- Administrator rodziny to dorosły, który ją założył (jeden na rodzinę, `family.admin_member_id`). Tylko on zmienia ustawienia rodziny, edytuje profile innych dorosłych, daje im kody resetu hasła i usuwa członków; jego samego nie da się usunąć, więc w rodzinie zawsze zostaje rodzic. Pozostali dorośli mają resztę uprawnień: zadania, akceptacje, nagrody, paczki, sklep, zapraszanie dzieci i dorosłych, edycję dzieci i własnego profilu. Usunięty członek traci dostęp, ale jego historia zostaje.

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
- Brak rzadkiej albo legendarnej w puli: paczka za serię daje najlepszą dostępną rzadkość, a puste miejsca zamieniają się na 5 pkt.
- Ceny przedmiotów: `price = NULL` oznacza tylko losowanie, `0` cenę rodziny dla danej rzadkości (domyślnie 30/80/200, zmiana w Nagrodach), `>0` stałą cenę.
- Nagroda od rodzica: punkty schodzą przy wyborze. Rodzic oznacza ją jako wydaną albo anuluje, a anulowanie zwraca punkty wpisem w księdze. Zakupy są atomowe, saldo nie zejdzie poniżej zera.

## Paczki i licencje

- Wbudowane paczki (`family_id NULL`) leżą w statycznych assetach Workera: to backend, nie APK, i jest darmowe. Każda rodzina może je wyłączyć u siebie. Paczki dodane przez rodzica trafiają do R2.
- Źródła:
  - Fluent Emoji (Microsoft, MIT) dla naklejek oraz ikonek zadań i nagród,
  - DiceBear Lorelei, Notionists, Open Peeps, Pixel Art i Thumbs (CC0 1.0) dla awatarów,
  - ramki narysowane w skrypcie („private”),
  - fonty z Google Fonts (OFL 1.1).
  Lista jest w aplikacji: „Licencje grafik”.

## Powiadomienia

- Jeden cron co 5 minut: generuje wystąpienia na 14 dni naprzód, wysyła przypomnienie (raz dziennie, tylko przy niezrobionych zadaniach) i dostarcza wstrzymane powiadomienia.
- W godzinach ciszy wszystko czeka. Po ich końcu każda osoba dostaje jedno zbiorcze powiadomienie.
- Token OAuth do FCM jest w pamięci podręcznej w D1 (około godziny). Nieważne tokeny urządzeń są usuwane.

## Wygląd

- 25 motywów z mockupów, dziecko wybiera w Profil → Wygląd aplikacji. Rodzic ma jeden neutralny styl.
- Poprawki kontrastu względem mockupów (guild, lanterns, detective, retro90, sport, monsters, comic): ciemniejsze kolory tekstu na jasnych kartach i nieco ciemniejsze tła przycisków, żeby spełnić WCAG AA.
- Napis na przycisku pochodzi z motywu. „Zrobiłem/Zrobiłam” dziecko wybiera samo.
