// Parsing the invite list (CR #134): e-mails separated by commas, semicolons, spaces or new lines. Shared by the dialog and POST /api/admin/invites.

export const MAX_INVITES = 50;
const EMAIL = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]{2,}$/;

export const isEmail = (s: string): boolean => s.length <= 254 && EMAIL.test(s);

/** `{emails}` are lower-cased, de-duplicated and valid; `bad` are the tokens that are not e-mail addresses. */
export function parseEmails(text: string): { emails: string[]; bad: string[] } {
  const emails: string[] = [], bad: string[] = [];
  for (const raw of text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const e = raw.toLowerCase();
    if (!isEmail(e)) bad.push(raw);
    else if (!emails.includes(e)) emails.push(e);
  }
  return { emails, bad };
}
