# Android APK (Capacitor)

Папка `mobile/` — готовый проект Capacitor 7 (`appId: com.mchat.app`, платформа Android уже добавлена).
Ранее Capacitor в проекте не было, идентификатор `com.mchat.app` ни с чем не конфликтует.

**Архитектура.** Приложение — нативная оболочка, которая открывает `https://mchat-web.org` в WebView (`server.url` в `capacitor.config.json`).
Так авторизация (cookie), WebSocket, service worker и постоянное хранилище работают ровно как на сайте, а обновления интерфейса приходят
без пересборки APK. Нужен интернет (без сети показывается `www/index.html` с кнопкой «Повторить»).

## Сборка
Нужны: JDK 21, Android Studio (или Android SDK + `ANDROID_HOME`).
```bash
cd mobile
npm install
npx cap sync android
npx cap open android                       # Android Studio → Build → Build APK(s)
# или из консоли:
cd android && ./gradlew assembleDebug      # APK: android/app/build/outputs/apk/debug/app-debug.apk
```
Релиз: создайте свой keystore (`keytool -genkey -v -keystore mchat.jks -alias mchat -keyalg RSA -keysize 2048 -validity 10000`), подпишите через
Android Studio → Generate Signed Bundle/APK. **Keystore и пароли в репозиторий не кладите.**

## Что настроено
- Разрешения: `INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`, `VIBRATE`
  (камера/микрофон помечены `required=false`). Запрос камеры/микрофона из WebView Capacitor превращает в системный диалог Android.
- `ScreenGuardPlugin.java` (регистрируется в `MainActivity`): `FLAG_SECURE` на окне — Android запрещает системные скриншоты и запись экрана
  и прячет содержимое в «недавних». Веб-слой включает его, пока открыто одноразовое фото/защищённый чат (`MchatNative.setSecure`).

## Известные ограничения (честно)
- **APK в этой среде не собран**: нет Android SDK и доступа к Google Maven/Gradle. Выдан готовый проект и команды, не установочный файл.
- **Вход через Google в WebView.** Google запрещает OAuth во встроенных WebView (`disallowed_useragent`). Для APK нужен вход через Chrome Custom Tab
  с возвратом по deep link (одноразовый код обмена на сессию) либо нативный Google Sign-In. **Это НЕ реализовано** — требует отдельной
  серверной доработки `/api/auth`. До этого вход работает в PWA/браузере, а в APK — только по уже выданной сессии.
- `FLAG_SECURE` не защищает от съёмки экрана другим устройством. В браузере/PWA веб-страница вообще не может запретить скриншоты
  и запись экрана — там остаются только скрытие/размытие содержимого при потере фокуса и одноразовая выдача файла сервером.
