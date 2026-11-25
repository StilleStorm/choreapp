/**
 * Public pages linked from Google Play and the app: the privacy policy and
 * how to delete an account. Static HTML with inline styles, no external resources.
 */
import { Hono } from 'hono';
import type { AppBindings } from './env.js';

const CONTACT = 'zadania@stillestormstudio.com';
const CONTROLLER = 'Stille Storm Studio';
const UPDATED = '25 listopada 2026';

function page(title: string, content: string): string {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} – Zadania</title>
<style>
  :root { color-scheme: light dark; --bg: #fbfaf7; --fg: #1f2328; --muted: #5b6168; --accent: #2f6f5e; --card: #ffffff; --line: #e4e1da; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16181b; --fg: #e9e7e2; --muted: #a4a9af; --accent: #7cc4ad; --card: #1f2226; --line: #33373c; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 4px; }
  h2 { font-size: 1.2rem; margin: 32px 0 8px; }
  p, li { margin: 0 0 10px; }
  ul, ol { padding-left: 22px; margin: 0 0 10px; }
  a { color: var(--accent); }
  .muted { color: var(--muted); font-size: 0.95rem; }
  .box { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin: 16px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }
  th, td { text-align: left; vertical-align: top; padding: 8px 6px; border-bottom: 1px solid var(--line); }
  .table { overflow-x: auto; }
</style>
</head>
<body><main>
${content}
</main></body>
</html>`;
}

const privacy = page(
  'Polityka prywatności',
  `<h1>Polityka prywatności aplikacji Zadania</h1>
<p class="muted">Ostatnia zmiana: ${UPDATED}</p>

<div class="box">
<p><strong>W skrócie:</strong> zbieramy tylko to, co potrzebne, żeby aplikacja działała w rodzinie. Dzieci nie podają e-maila, hasła ani prawdziwego imienia. Nie ma reklam, analityki ani śledzenia. Nie sprzedajemy danych i nikomu ich nie udostępniamy poza firmami, które technicznie obsługują aplikację.</p>
</div>

<h2>1. Kto odpowiada za dane</h2>
<p>Administratorem danych jest ${CONTROLLER}. Kontakt we wszystkich sprawach dotyczących danych: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>

<h2>2. Jakie dane zbieramy i po co</h2>
<div class="table"><table>
<tr><th>Dane</th><th>Czyje</th><th>Po co</th></tr>
<tr><td>Adres e-mail i hasło (przechowujemy tylko skrót hasła PBKDF2, nigdy samo hasło)</td><td>dorośli</td><td>logowanie, zmiana zapomnianego hasła</td></tr>
<tr><td>Imię dorosłego, nazwa rodziny</td><td>dorośli</td><td>pokazanie w aplikacji członkom rodziny</td></tr>
<tr><td>Nazwa dziecka wybrana w aplikacji (może być pseudonim; prosimy, żeby nie wpisywać nazwiska)</td><td>dzieci</td><td>pokazanie w aplikacji członkom rodziny</td></tr>
<tr><td>Zdjęcie profilowe (opcjonalne, zmniejszane na telefonie do 256 pikseli) albo wybrany awatar i ramka</td><td>wszyscy</td><td>obrazek profilu widoczny dla rodziny</td></tr>
<tr><td>Zadania, zgłoszenia ich wykonania, akceptacje, komentarze rodzica, punkty, naklejki, nagrody i ich odbiór</td><td>rodzina</td><td>działanie aplikacji</td></tr>
<tr><td>Obrazki dodane przez rodzica do własnych paczek naklejek</td><td>dorośli</td><td>naklejki i nagrody w rodzinie</td></tr>
<tr><td>Ustawienia: strefa czasowa, godziny ciszy, godzina przypomnienia, wygląd aplikacji</td><td>rodzina</td><td>działanie aplikacji</td></tr>
<tr><td>Token powiadomień push (Firebase Cloud Messaging) i numer wersji aplikacji</td><td>wszyscy</td><td>wysyłanie powiadomień o zadaniach i nagrodach</td></tr>
<tr><td>Identyfikator sesji (losowy, przechowujemy tylko jego skrót)</td><td>wszyscy</td><td>utrzymanie zalogowania</td></tr>
<tr><td>Adres IP</td><td>wszyscy</td><td>ochrona przed zgadywaniem haseł i kodów (liczniki prób kasowane po 15–60 minutach) oraz techniczne logi serwera (kilka dni)</td></tr>
</table></div>
<p>Nie zbieramy lokalizacji, kontaktów, numeru telefonu, identyfikatora reklamowego ani danych o korzystaniu z innych aplikacji. Aplikacja nie zawiera reklam ani narzędzi analitycznych.</p>
<p>Kod QR do dołączenia skanuje skaner Google (Google ML Kit / usługi Google Play) bezpośrednio na telefonie; aplikacja nie dostaje dostępu do aparatu ani zdjęć z niego.</p>

<h2>3. Dzieci</h2>
<ul>
<li>Profil dziecka zakłada i nim zarządza rodzic lub opiekun. Dziecko dołącza jednorazowym kodem QR albo 6 cyframi od dorosłego; zgoda i nadzór należą do rodzica.</li>
<li>Od dziecka nie zbieramy e-maila, hasła, nazwiska, daty urodzenia ani lokalizacji. Dziecko wybiera tylko nazwę (może być pseudonim) i opcjonalnie zdjęcie albo awatar.</li>
<li>Dane dziecka widzi tylko jego rodzina w aplikacji. Nie są publiczne i nie trafiają do nikogo innego.</li>
<li>Rodzic może w każdej chwili zmienić nazwę dziecka albo usunąć jego profil razem ze wszystkimi danymi (Ustawienia → dziecko → Usuń z rodziny).</li>
</ul>

<h2>4. Podstawa prawna (RODO)</h2>
<ul>
<li>Wykonanie umowy, czyli świadczenie usługi, z której korzystasz (art. 6 ust. 1 lit. b RODO): konto, rodzina, zadania, powiadomienia.</li>
<li>Prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO): bezpieczeństwo, ochrona przed nadużyciami, logi techniczne.</li>
<li>Dane dziecka przetwarzamy na prośbę i pod nadzorem rodzica lub opiekuna prawnego, który zakłada jego profil.</li>
</ul>

<h2>5. Gdzie są dane i kto je przetwarza</h2>
<p>Nie sprzedajemy danych i nie udostępniamy ich innym firmom w celach marketingowych. Korzystamy tylko z dostawców, którzy technicznie obsługują aplikację na nasze zlecenie:</p>
<ul>
<li><strong>Cloudflare, Inc.</strong>: serwer aplikacji, baza danych i pliki (Cloudflare Workers, D1, R2). Baza i pliki są przechowywane w Europie (region Europa Zachodnia). Cloudflare wysyła też e-maile z kodem do zmiany hasła (Cloudflare Email Sending).</li>
<li><strong>Google (Firebase Cloud Messaging)</strong>: dostarczanie powiadomień push na telefon. Powiadomienie zawiera krótki tekst, np. tytuł zadania i nazwę osoby.</li>
<li><strong>Google ML Kit / usługi Google Play</strong>: skaner kodu QR działający na telefonie.</li>
</ul>
<p>Jeśli dostawca przetwarza dane poza Europejskim Obszarem Gospodarczym, odbywa się to na podstawie standardowych klauzul umownych lub decyzji Komisji Europejskiej o odpowiednim poziomie ochrony.</p>
<p>Połączenie z serwerem jest szyfrowane (HTTPS). Zdjęcia i obrazki są dostępne tylko przez podpisane adresy ważne najwyżej 48 godzin.</p>

<h2>6. Jak długo przechowujemy dane</h2>
<ul>
<li>Dane konta i rodziny: dopóki konto istnieje. Po usunięciu konta lub rodziny dane są kasowane od razu, łącznie ze zdjęciami.</li>
<li>Kody zaproszeń i kody zmiany hasła: ważne 15 minut, potem bezużyteczne.</li>
<li>Liczniki prób logowania (z adresem IP lub e-mailem): od 15 minut do 1 godziny.</li>
<li>Logi techniczne serwera u Cloudflare: kilka dni.</li>
<li>Tokeny powiadomień: do wylogowania, usunięcia konta albo unieważnienia tokenu przez Google.</li>
</ul>

<h2>7. Usunięcie konta</h2>
<p>Konto można usunąć w aplikacji: Ustawienia → Konto → Usuń konto. Administrator rodziny usuwa w ten sposób całą rodzinę ze wszystkimi danymi. Można też napisać na <a href="mailto:${CONTACT}">${CONTACT}</a> z adresu e-mail konta. Szczegóły: <a href="/delete-account">jak usunąć konto</a>.</p>

<h2>8. Twoje prawa</h2>
<p>Masz prawo do dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przeniesienia oraz sprzeciwu. Rodzic lub opiekun wykonuje te prawa w imieniu dziecka. Większość zmian zrobisz sam w aplikacji; w innych sprawach napisz na <a href="mailto:${CONTACT}">${CONTACT}</a>, odpowiemy w ciągu 30 dni.</p>
<p>Masz też prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa, <a href="https://uodo.gov.pl">uodo.gov.pl</a>).</p>

<h2>9. Zmiany</h2>
<p>O ważnych zmianach tej polityki poinformujemy w aplikacji. Data ostatniej zmiany jest na górze strony.</p>`,
);

const deleteAccount = page(
  'Usuwanie konta',
  `<h1>Jak usunąć konto w aplikacji Zadania</h1>
<p class="muted">Aplikacja Zadania, ${CONTROLLER}</p>

<h2>W aplikacji (od razu)</h2>
<ol>
<li>Zaloguj się jako dorosły.</li>
<li>Otwórz <strong>Ustawienia</strong> i przewiń do sekcji <strong>Konto</strong>.</li>
<li>Dotknij <strong>Usuń konto</strong> (administrator rodziny widzi <strong>Usuń całą rodzinę</strong>).</li>
<li>Wpisz swoje hasło i potwierdź.</li>
</ol>
<p>Profil dziecka usuwa administrator rodziny: <strong>Ustawienia → dotknij dziecka → Usuń z rodziny</strong>. Dzieci nie mają własnego konta z e-mailem.</p>

<h2>E-mailem (do 30 dni)</h2>
<p>Jeśli nie masz dostępu do aplikacji, napisz na <a href="mailto:${CONTACT}?subject=Usuni%C4%99cie%20konta">${CONTACT}</a> z adresu e-mail, którego używasz do logowania, z prośbą o usunięcie konta (albo całej rodziny, jeśli jesteś jej administratorem). Usuniemy dane w ciągu 30 dni i potwierdzimy to e-mailem.</p>

<h2>Co zostaje usunięte</h2>
<ul>
<li><strong>Konto dorosłego:</strong> e-mail, skrót hasła, imię, zdjęcie profilowe, sesje, tokeny powiadomień, kody zaproszeń i zmiany hasła. Zadania, które ta osoba założyła, zostają w rodzinie (przypisane administratorowi), bez jej danych.</li>
<li><strong>Cała rodzina (administrator):</strong> wszyscy członkowie i ich dane, zadania, zgłoszenia, punkty, naklejki, nagrody, własne paczki naklejek, wszystkie zdjęcia i obrazki, ustawienia rodziny.</li>
<li><strong>Profil dziecka:</strong> nazwa, zdjęcie, punkty, naklejki, historia zadań i nagród, sesje i tokeny powiadomień.</li>
</ul>
<p>Usunięcie w aplikacji jest natychmiastowe i nieodwracalne. Nie przechowujemy kopii usuniętych danych. Krótkotrwałe logi techniczne serwera (adres IP, czas zapytania) znikają same po kilku dniach.</p>
<p><a href="/privacy">Polityka prywatności</a></p>`,
);

export const pages = new Hono<AppBindings>()
  .get('/privacy', (c) => c.html(privacy))
  .get('/delete-account', (c) => c.html(deleteAccount));
