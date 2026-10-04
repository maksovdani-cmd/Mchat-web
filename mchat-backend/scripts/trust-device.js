// Аварийный вход: помечает ваш браузер «доверенным устройством», чтобы Mchat не требовал код.
// Запуск (из папки mchat-backend):
//   DATABASE_URL="внешний адрес базы из Render" node scripts/trust-device.js ваша_почта@gmail.com
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('Укажите почту: node scripts/trust-device.js you@gmail.com'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('Не задан DATABASE_URL'); process.exit(1); }

const prisma = new PrismaClient();
(async () => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { console.error('Пользователь с такой почтой не найден: ' + email); process.exit(1); }

  // снимаем ограничение «не больше 5 кодов за 15 минут» и старые коды
  const del = await prisma.loginCode.deleteMany({ where: { userId: user.id } });

  const raw = crypto.randomBytes(32).toString('base64url');
  await prisma.device.create({
    data: { userId: user.id, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), label: 'Аварийный вход', ip: '' },
  });

  console.log('\nГотово. Старых кодов удалено: ' + del.count);
  console.log('Теперь откройте сайт, нажмите F12 → вкладка Console и вставьте эту строку:\n');
  console.log(`document.cookie = "mchat_device=${raw}; path=/; max-age=31536000; secure; samesite=lax"\n`);
  console.log('Потом обновите страницу и нажмите «Войти через Google» — код больше не спросят.\n');
  await prisma.$disconnect();
})().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });