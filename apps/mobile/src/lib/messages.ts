/** Polish messages for API error codes. */
import { ApiFailure } from './api.js';

const MESSAGES: Record<string, string> = {
  network: 'Brak połączenia z internetem. Spróbuj za chwilę.',
  server_error: 'Coś poszło nie tak po naszej stronie. Spróbuj ponownie.',
  unauthorized: 'Sesja wygasła. Zaloguj się ponownie.',
  forbidden: 'Nie masz do tego uprawnień.',
  parent_only: 'To może zrobić tylko rodzic.',
  child_only: 'To może zrobić tylko dziecko.',
  not_found: 'Nie znaleziono.',
  invalid_input: 'Sprawdź, czy wszystkie pola są poprawnie wypełnione.',
  invalid_json: 'Niepoprawne dane.',
  too_many_attempts: 'Za dużo prób. Odczekaj kwadrans i spróbuj ponownie.',
  invalid_credentials: 'Nieprawidłowy e-mail lub hasło.',
  email_taken: 'Ten e-mail jest już używany.',
  invite_invalid: 'Ten kod jest nieprawidłowy, wygasł albo został już użyty. Poproś rodzica o nowy.',
  name_required: 'Wpisz imię.',
  email_password_required: 'Wpisz e-mail i hasło.',
  password_required: 'Wpisz nowe hasło.',
  token_or_code: 'Zeskanuj kod QR albo wpisz 6 cyfr.',
  role_mismatch: 'Nie można utworzyć takiego zaproszenia.',
  member_not_found: 'Nie znaleziono tej osoby.',
  last_parent: 'W rodzinie musi zostać co najmniej jeden rodzic.',
  unsupported_image_type: 'Ten format zdjęcia nie jest obsługiwany.',
  empty_image: 'Zdjęcie jest puste.',
  image_too_large: 'Zdjęcie jest za duże.',
  item_not_owned: 'Tego jeszcze nie masz w kolekcji.',
  bad_signature: 'Link do pliku wygasł.',
  // Tasks and reviews
  invalid_recurrence: 'Sprawdź ustawienia powtarzania.',
  assignee_not_child: 'Zadania można przypisać tylko dzieciom z rodziny.',
  task_not_found: 'To zadanie już nie istnieje.',
  occurrence_not_found: 'To zadanie już nie istnieje.',
  not_assigned: 'To zadanie nie jest przypisane do Ciebie.',
  not_reportable: 'Tego zadania nie można teraz zgłosić.',
  future_task: 'To zadanie jest na inny dzień. Zgłosić można tylko dzisiejsze i zaległe.',
  already_reported: 'To zadanie jest już zgłoszone.',
  already_done: 'To zadanie jest już zrobione.',
  not_pending: 'To zgłoszenie zostało już sprawdzone.',
  // Shop
  insufficient_points: 'Za mało punktów.',
  already_owned: 'To już masz w kolekcji.',
  not_for_sale: 'Tego nie da się kupić.',
  reward_inactive: 'Ta nagroda jest teraz niedostępna.',
  pack_builtin: 'Wbudowanej paczki nie można edytować, można ją tylko wyłączyć.',
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiFailure) return MESSAGES[e.code] ?? e.message ?? 'Wystąpił błąd.';
  console.error(e);
  return 'Wystąpił nieoczekiwany błąd.';
}
