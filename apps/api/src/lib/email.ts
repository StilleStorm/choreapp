/** Outgoing e-mail (Cloudflare Email Sending). Adults only: children never give an e-mail. */

export const EMAIL_FROM = { email: 'noreply@stillestormstudio.com', name: 'Zadania' } as const;
export const EMAIL_REPLY_TO = 'zadania@stillestormstudio.com';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** The password reset code, e.g. "123456" shown as "123 456". */
export function passwordResetEmail(to: string, code: string): EmailMessageBuilder {
  const shown = `${code.slice(0, 3)} ${code.slice(3)}`;
  const lines = [
    'Ktoś poprosił o zmianę hasła do konta w aplikacji Zadania (rodzinne zadania i nagrody).',
    `Twój kod: ${shown}`,
    'Kod jest ważny 15 minut.',
    'Jeśli to nie Ty, zignoruj tę wiadomość.',
    'Odpowiedzi na tego maila trafiają do autora aplikacji Zadania.',
  ];
  const html = `<!doctype html><html lang="pl"><body style="font-family:sans-serif;line-height:1.5;color:#222">
<p>${escapeHtml(lines[0]!)}</p>
<p>Twój kod: <strong style="font-size:1.5em;letter-spacing:0.1em">${escapeHtml(shown)}</strong></p>
<p>${escapeHtml(lines[2]!)}</p>
<p>${escapeHtml(lines[3]!)}</p>
<p style="color:#666;font-size:0.9em">${escapeHtml(lines[4]!)}</p>
</body></html>`;
  return {
    from: EMAIL_FROM,
    to,
    replyTo: EMAIL_REPLY_TO,
    subject: '[Zadania] Kod do zmiany hasła',
    text: lines.join('\n\n') + '\n',
    html,
  };
}
