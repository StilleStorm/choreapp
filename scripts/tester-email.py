"""Email Play testers about a new closed-test version (Polish, HTML + text).

Usage:
  python3 -I scripts/tester-email.py <version> <notes.txt> <to> [bcc ...]

notes.txt: one "what's new" item per line. Adults test only through Google Play
(the 12-tester requirement). Separate parent and child sections: a child without a phone uses
the parent's Play app via "Przełącz na konto dziecka" (needs the child-swap release); a child with
a phone gets the APK link (Play forbids minors in tests). Sent from hello@stillestormstudio.com
via Cloudflare Email Sending (wrangler, run from apps/api). Put the testers in
BCC and hello@ in <to>, so nobody sees the others' addresses. Send only after
Google has approved the version.
"""
import html, os, subprocess, sys

OPT_IN = "https://play.google.com/apps/testing/app.choreapp.family"
STORE = "https://play.google.com/store/apps/details?id=app.choreapp.family"
FROM = "hello@stillestormstudio.com"
KIDS_APK = "https://github.com/StilleStorm/choreapp/releases/download/v{v}/choreapp-{v}.apk"
ICON = os.environ.get("EMAIL_ICON_URL", "https://choreapp-api.stillestormstudio.workers.dev/builtin/brand/icon-128.png")

version, notes_path, to, bcc = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
kids_apk = KIDS_APK.format(v=version)
notes = [l.strip() for l in open(notes_path, encoding="utf-8") if l.strip()]

INK, ORANGE, CREAM, SOFT = "#4A2A14", "#FA901D", "#FFF7EC", "#FFE9CC"


def button(href, label, primary):
    bg, fg = (ORANGE, INK) if primary else ("#FFFFFF", INK)
    return (f'<a href="{href}" style="display:inline-block;background:{bg};color:{fg};'
            f'border:2px solid {INK};border-radius:14px;box-shadow:0 3px 0 {INK};'
            f'padding:9px 16px;font-weight:700;font-size:14px;text-decoration:none;margin:4px 6px 4px 0">{label}</a>')


PENDING = os.environ.get("PENDING_REVIEW") == "1"
PENDING_TEXT = "Google jeszcze sprawdza tę wersję. Do testów możecie dołączyć już teraz, a jeśli Google Play pokaże, że aplikacja jest niedostępna, zajrzyjcie za kilka godzin."
PENDING_HTML = (f'<p style="margin:-6px 0 14px;font-size:13px;color:#7A5A40;">{PENDING_TEXT}</p>' if PENDING else "")
items = "".join(f'<li style="margin:0 0 6px">{html.escape(n)}</li>' for n in notes)
body_html = f"""<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:{CREAM};-webkit-text-size-adjust:100%;text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{CREAM};">
<tr><td align="center" style="padding:12px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:2px solid {INK};border-radius:22px;font-family:'Trebuchet MS',Verdana,Arial,sans-serif;color:{INK};">
<tr><td style="background:{ORANGE};border-radius:20px 20px 0 0;padding:14px 18px;border-bottom:2px solid {INK};">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td style="padding-right:12px;"><img src="{ICON}" width="48" height="48" alt="" style="display:block;border:2px solid {INK};border-radius:12px;"></td>
  <td><div style="font-size:20px;font-weight:800;line-height:1.1;">Zadania</div>
  <div style="font-size:13px;font-weight:600;">rodzinne misje &middot; wersja {html.escape(version)}</div></td>
  </tr></table>
</td></tr>
<tr><td style="padding:18px 18px 6px;font-size:14px;line-height:1.45;">
  <p style="margin:0 0 14px;">Cześć!</p>
  <p style="margin:0 0 14px;">Jest nowa wersja Zadań. Dzięki, że testujecie ją razem z nami!</p>
  <div style="background:{SOFT};border:2px solid {INK};border-radius:16px;padding:10px 14px;margin:0 0 16px;">
    <div style="font-weight:800;margin:0 0 8px;">Co nowego</div>
    <ul style="margin:0;padding-left:20px;">{items}</ul>
  </div>
  <div style="border:2px solid {INK};border-radius:16px;padding:10px 14px;margin:0 0 16px;">
    <div style="font-weight:800;font-size:16px;margin:0 0 8px;">&#128104;&#8205;&#128105; Dla rodziców</div>
    <p style="margin:0 0 4px;font-weight:800;">Jeszcze Was nie ma w testach?</p>
    <p style="margin:0 0 10px;">Dołączcie i zainstalujcie aplikację z Google Play, tym samym kontem Google, na które przyszedł ten mail.</p>
    <p style="margin:0 0 14px;">{button(OPT_IN, "Dołącz do testów", True)}</p>
    {PENDING_HTML}
    <p style="margin:0 0 4px;font-weight:800;">Już testujecie?</p>
    <p style="margin:0 0 10px;">Zaktualizujcie aplikację w Google Play.</p>
    <p style="margin:0;">{button(STORE, "Otwórz w Google Play", False)}</p>
  </div>
  <div style="border:2px dashed {INK};border-radius:16px;padding:10px 14px;margin:0 0 16px;">
    <div style="font-weight:800;font-size:16px;margin:0 0 8px;">&#129490; Dla dzieci</div>
    <p style="margin:0 0 10px;">Google Play nie pozwala dzieciom (kontom Google osób niepełnoletnich) dołączać do testów. Na czas testów dziecko może korzystać z Zadań na jeden z dwóch sposobów:</p>
    <p style="margin:0 0 4px;font-weight:800;">Dziecko nie ma swojego telefonu</p>
    <p style="margin:0 0 12px;">Użyjcie aplikacji z Google Play na telefonie rodzica: w Ustawieniach wybierzcie „Przełącz na konto dziecka” i podajcie telefon dziecku. Powrót do konta rodzica odblokujecie odciskiem palca, PIN-em lub wzorem, tak jak sam telefon.</p>
    <p style="margin:0 0 4px;font-weight:800;">Dziecko ma swój telefon</p>
    <p style="margin:0 0 10px;">Zainstalujcie na nim aplikację z tego linku. Android zapyta o zgodę na instalację spoza sklepu, a dalsze wersje aplikacja pobierze już sama.</p>
    <p style="margin:0 0 10px;">{button(kids_apk, "Pobierz na telefon dziecka", False)}</p>
    <p style="margin:0;font-size:13px;color:#7A5A40;">Po premierze Zadania będą w Google Play dostępne także na telefonach dzieci.</p>
  </div>
  <p style="margin:0 0 14px;">Coś nie działa albo macie pomysł? Odpiszcie na tego maila, czytamy wszystko.</p>
  <p style="margin:0 0 22px;">Ściskamy całą rodzinkę!<br><strong>Stille Storm Studio</strong></p>
</td></tr>
<tr><td style="padding:12px 18px 16px;border-top:2px dashed {SOFT};font-size:11px;line-height:1.45;color:#7A5A40;">
  Jesteście na liście testerów Zadań. Nie chcecie już testować? Odpiszcie „rezygnuję”.
</td></tr>
</table></td></tr></table></body></html>"""

body_text = "\n".join([
    "Cześć!", "",
    "Jest nowa wersja Zadań (" + version + "). Dzięki, że testujecie ją razem z nami!", "",
    "Co nowego:", *[f"- {n}" for n in notes], "",
    "DLA RODZICÓW", "",
    "Jeszcze Was nie ma w testach? Dołączcie tutaj (tym samym kontem Google, na które przyszedł ten mail):", OPT_IN, "",
    *([PENDING_TEXT, ""] if PENDING else []),
    "Już testujecie? Zaktualizujcie aplikację w Google Play:", STORE, "",
    "DLA DZIECI", "",
    "Google Play nie pozwala dzieciom (kontom Google osób niepełnoletnich) dołączać do testów. Na czas testów dziecko może korzystać z Zadań na jeden z dwóch sposobów:", "",
    "Dziecko nie ma swojego telefonu: użyjcie aplikacji z Google Play na telefonie rodzica. W Ustawieniach wybierzcie „Przełącz na konto dziecka” i podajcie telefon dziecku. Powrót do konta rodzica odblokujecie odciskiem palca, PIN-em lub wzorem, tak jak sam telefon.", "",
    "Dziecko ma swój telefon: zainstalujcie na nim aplikację z tego linku (Android zapyta o zgodę na instalację spoza sklepu, dalsze wersje aplikacja pobierze sama):", kids_apk, "",
    "Po premierze Zadania będą w Google Play dostępne także na telefonach dzieci.", "",
    "Coś nie działa albo macie pomysł? Po prostu odpiszcie na tego maila.", "",
    "Ściskamy całą rodzinkę!", "Stille Storm Studio",
])

if os.environ.get("DUMP_HTML"):
    open(os.environ["DUMP_HTML"], "w", encoding="utf-8").write(body_html)
    sys.exit(0)

cmd = ["npx", "wrangler", "email", "sending", "send", "--from", FROM, "--from-name", "Stille Storm Studio",
       "--reply-to", FROM, "--to", to, "--subject", f"Nowa wersja Zadań ({version}) już czeka!",
       "--text", body_text, "--html", body_html]
for b in bcc:
    cmd += ["--bcc", b]
api_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "api")
sys.exit(subprocess.run(cmd, cwd=api_dir).returncode)
