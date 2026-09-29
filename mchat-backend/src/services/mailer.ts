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

export const mailEnabled = () => transport !== null;

export async function sendLoginCodeEmail(to: string, code: string, label: string): Promise<boolean> {
  if (!transport) {
    if (!config.isProd) {
      console.log(`\n📧 [DEV] Код входа для ${to}: ${code}  (${label})\n`);
      return true;
    }
    console.error('SMTP не настроен — письмо с кодом не отправлено');
    return false;
  }
  try {
    await transport.sendMail({
      from: config.MAIL_FROM,
      to,
      subject: `Код входа в Mchat: ${code}`,
      text:
        `Код для входа в Mchat: ${code}\n\n` +
        `Кто-то входит в ваш аккаунт с нового устройства (${label}).\n` +
        `Код действует 10 минут. Если это были не вы — просто проигнорируйте письмо и никому не сообщайте код.`,
    });
    return true;
  } catch (e) {
    console.error('Ошибка отправки письма:', (e as Error).message);
    return false;
  }
}
