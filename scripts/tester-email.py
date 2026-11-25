"""Email Play testers about a new closed-test version (Polish, HTML + text).

Usage:
  python3 -I scripts/tester-email.py <version> <notes.txt> <to> [bcc ...]

notes.txt: one "what's new" item per line. Sent from hello@stillestormstudio.com
via Cloudflare Email Sending (wrangler, run from apps/api). Put the testers in
BCC and hello@ in <to>, so nobody sees the others' addresses. Send only after
Google has approved the version.
"""
import html, os, subprocess, sys

OPT_IN = "https://play.google.com/apps/testing/app.choreapp.family"
STORE = "https://play.google.com/store/apps/details?id=app.choreapp.family"
FROM = "hello@stillestormstudio.com"
ICON = os.environ.get("EMAIL_ICON_URL", "https://choreapp-api.stillestormstudio.workers.dev/builtin/brand/icon-128.png")

version, notes_path, to, bcc = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
notes = [l.strip() for l in open(notes_path, encoding="utf-8") if l.strip()]

INK, ORANGE, CREAM, SOFT = "#4A2A14", "#FA901D", "#FFF7EC", "#FFE9CC"


def button(href, label, primary):
    bg, fg = (ORANGE, INK) if primary else ("#FFFFFF", INK)
    return (f'<a href="{href}" style="display:inline-block;background:{bg};color:{fg};'
            f'border:2px solid {INK};border-radius:14px;box-shadow:0 3px 0 {INK};'
            f'padding:9px 16px;font-weight:700;font-size:14px;text-decoration:none;margin:4px 6px 4px 0">{label}</a>')


items = "".join(f'<li style="margin:0 0 6px">{html.escape(n)}</li>' for n in notes)
body_html = f"""<!doctype html><html lang="pl"><body style="margin:0;background:{CREAM};">
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
<tr><td style="padding:18px 18px 6px;font-size:14px;line-height:1.5;">
  <p style="margin:0 0 14px;">Cześć!</p>
  <p style="margin:0 0 14px;">Jest nowa wersja Zadań, czyli aplikacji, w której dzieci odhaczają swoje obowiązki, zbierają punkty i naklejki, a rodzice tylko zatwierdzają. Dzięki, że testujecie ją razem z nami!</p>
  <div style="background:{SOFT};border:2px solid {INK};border-radius:16px;padding:10px 14px;margin:0 0 16px;">
    <div style="font-weight:800;margin:0 0 8px;">Co nowego</div>
    <ul style="margin:0;padding-left:20px;">{items}</ul>
  </div>
  <p style="margin:0 0 4px;font-weight:800;">Jeszcze Was nie ma w testach?</p>
  <p style="margin:0 0 10px;">Kliknijcie „Dołącz do testów”, potwierdźcie na stronie Google, a potem zainstalujcie aplikację z Google Play. Ważne: w Google Play zalogujcie się tym samym kontem Google, na które przyszedł ten mail.</p>
  <p style="margin:0 0 18px;">{button(OPT_IN, "Dołącz do testów", True)}</p>
  <p style="margin:0 0 4px;font-weight:800;">Już testujecie?</p>
  <p style="margin:0 0 10px;">Wystarczy zaktualizować aplikację w Google Play. Telefon zwykle zrobi to sam, ale możecie go trochę pospieszyć.</p>
  <p style="margin:0 0 18px;">{button(STORE, "Otwórz w Google Play", False)}</p>
  <p style="margin:0 0 14px;">Coś nie działa, coś jest niejasne albo macie pomysł, co by się przydało? Po prostu odpiszcie na tego maila. Czytamy wszystko i każda uwaga naprawdę pomaga.</p>
  <p style="margin:0 0 22px;">Ściskamy całą rodzinkę!<br><strong>Stille Storm Studio</strong></p>
</td></tr>
<tr><td style="padding:12px 18px 16px;border-top:2px dashed {SOFT};font-size:11px;line-height:1.45;color:#7A5A40;">
  Dostajecie tę wiadomość, bo jesteście na liście testerów aplikacji Zadania. Jeśli nie chcecie już testować, odpiszcie „rezygnuję”, a usuniemy Was z listy.
</td></tr>
</table></td></tr></table></body></html>"""

body_text = "\n".join([
    "Cześć!", "",
    "Jest nowa wersja Zadań (" + version + "), czyli aplikacji, w której dzieci odhaczają swoje obowiązki, zbierają punkty i naklejki, a rodzice tylko zatwierdzają. Dzięki, że testujecie ją razem z nami!", "",
    "Co nowego:", *[f"- {n}" for n in notes], "",
    "Jeszcze Was nie ma w testach? Dołączcie tutaj (tym samym kontem Google, na które przyszedł ten mail):", OPT_IN, "",
    "Już testujecie? Zaktualizujcie aplikację w Google Play:", STORE, "",
    "Coś nie działa albo macie pomysł? Po prostu odpiszcie na tego maila.", "",
    "Ściskamy całą rodzinkę!", "Stille Storm Studio",
])

cmd = ["npx", "wrangler", "email", "sending", "send", "--from", FROM, "--from-name", "Stille Storm Studio",
       "--reply-to", FROM, "--to", to, "--subject", f"Nowa wersja Zadań ({version}) już czeka!",
       "--text", body_text, "--html", body_html]
for b in bcc:
    cmd += ["--bcc", b]
api_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "api")
sys.exit(subprocess.run(cmd, cwd=api_dir).returncode)
