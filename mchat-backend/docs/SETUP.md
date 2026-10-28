# Установка и запуск (локально)

Требования: Node.js 22+, PostgreSQL 14+.

```bash
cd mchat-backend
cp .env.example .env          # заполните DATABASE_URL, JWT_SECRET (npm run secret), GOOGLE_*, VAPID_* (npm run vapid)
npm install
npx prisma generate
npm run db:push               # создаёт/обновляет таблицы и колонки (в т.ч. новые: ChatMember.draft, ChatMember.draftAt)
npm run dev                   # http://localhost:3000
```
Проект использует `prisma db push` (папки migrations нет) — так же работает `npm run start:prod` на Render. Новые колонки черновиков
необязательные (NULL), существующие данные не затрагиваются.

## Тесты
```bash
npm test
```
Запускает: разбиение текста (4000 символов, эмодзи), ядро черновиков, UI-смоук series8 в jsdom (шапка, пузыри, черновики, ОТМЕНА),
драйвер Cloudinary с подменённым fetch (подпись, повторы, лимит). Тесты не требуют БД и сети.
Проверка типов (`npm run typecheck`) требует сгенерированного Prisma-клиента (`npx prisma generate` — нужен доступ к binaries.prisma.sh).

## Переменные окружения
Полный список с пояснениями — `.env.example`. Секреты в архив не входят.
