# Деплой на Render и проверка постоянного хранения

1. Render → Web Service из репозитория (Docker; `Dockerfile` в `mchat-backend/`). Start command: `npm run start:prod`.
2. Environment: все переменные из `.env.example` (минимум: `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_*`, `APP_URL=https://mchat-web.org`,
   `VAPID_*`, `ZEGO_*`, `CLOUDINARY_*` либо `S3_*`).
3. Домен: Settings → Custom Domains → `mchat-web.org` (+ `www`); в Google Cloud Console добавьте redirect URI
   `https://mchat-web.org/api/auth/google/callback` и origin `https://mchat-web.org`.
4. `git push` → Render собирает и запускает. При старте `prisma db push` добавит новые колонки.
5. Проверка хранилища: в логах нет предупреждения про диск; отправьте фото → Manual Deploy → фото открывается (см. `STORAGE.md`).
6. Проверка SEO: `https://mchat-web.org/robots.txt`, `/sitemap.xml`; у `/api/*`, `/profile/*`, `/join/*` заголовок `X-Robots-Tag: noindex`.
7. Ссылка на APK: после публикации файла впишите её в `public/app-config.json` → `{"apkUrl": "https://…/mchat.apk"}`; до этого кнопки APK нет.
