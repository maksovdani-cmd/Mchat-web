import nodemailer from 'nodemailer';
import { config } from '../config';

const transport = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null;

export const mailEnabled = () => !!config.BREVO_API_KEY || transport !== null;

/** «Mchat <me@gmail.com>» → { name, email } */
function parseFrom(from: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].trim() || 'Mchat', email: m[2].trim() } : { name: 'Mchat', email: from.trim() };
}

export async function sendLoginCodeEmail(to: string, code: string, label: string): Promise<boolean> {
  const subject = `Код входа в Mchat: ${code}`;
  const text =
    `Код для входа в Mchat: ${code}\n\n` +
    `Кто-то входит в ваш аккаунт с нового устройства (${label}).\n` +
    `Код действует 10 минут. Если это были не вы — просто проигнорируйте письмо и никому не сообщайте код.`;

  // 1) HTTPS-API Brevo: на бесплатном Render SMTP-порты закрыты, а HTTPS (443) — нет
  if (config.BREVO_API_KEY) {
    try {
      const r = await fetch(config.BREVO_API_URL, {
        method: 'POST',
        headers: { 'api-key': config.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: parseFrom(config.MAIL_FROM), to: [{ email: to }], subject, textContent: text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        console.error('Brevo: письмо не отправлено', r.status, (await r.text()).slice(0, 300));
        return false;
      }
      return true;
    } catch (e) {
      console.error('Brevo: ошибка отправки письма:', (e as Error).message);
      return false;
    }
  }

  // 2) обычный SMTP (на платных хостингах и локально)
  if (!transport) {
    if (!config.isProd) {
      console.log(`\n📧 [DEV] Код входа для ${to}: ${code}  (${label})\n`);
      return true;
    }
    console.error('Почта не настроена (нет BREVO_API_KEY и SMTP_HOST) — письмо с кодом не отправлено');
    return false;
  }
  try {
    await transport.sendMail({ from: config.MAIL_FROM, to, subject, text });
    return true;
  } catch (e) {
    console.error('Ошибка отправки письма:', (e as Error).message);
    return false;
  }
}
