# Что заменено в твоём фронтенде

Файлы уже пропатчены (`public/`). Это карта изменений — что на какой запрос переехало.
Все запросы находятся в `public/mchat-api.js`, `script.js` вызывает только `MchatAPI.*`.

## index.html
* Добавлены `<link rel="manifest">`, `<meta name="theme-color">` и три скрипта **перед** `script.js`:
  `/socket.io/socket.io.js` (отдаёт сам сервер), `mchat-api.js`, `script.js`.
* Экран входа: убраны вкладки «Войти/Регистрация», пароль, подтверждение пароля, глазки, «Забыл пароль?».
  Осталось поле `@username` и кнопка Google (`#auth-btn`, тот же `.btn-login`).
* Экран `#s-password-recovery` заменён на `#s-code` (ввод кода нового устройства) — на тех же классах стилей.

## script.js
| Твоя функция | Что теперь | Запрос |
|---|---|---|
| `init()` | проверяет сессию, подключает сокет, грузит чаты | `GET /api/me`, `io()` |
| `authAction()` | ник → Google | редирект `GET /api/auth/google/start?username=` |
| *(новое)* `showCodeScreen / submitLoginCode / sendCodeByEmail` | код нового устройства | `GET /api/auth/pending`, `POST /api/auth/verify-code`, `POST /api/auth/send-email-code` |
| *(новое)* `showLoginCodeModal` | уже вошедшее устройство показывает код | событие сокета `auth:login-code` |
| `logout()` | отзыв сессии на сервере | `POST /api/auth/logout` |
| `deleteAccount()` | удаление на сервере | `DELETE /api/me` |
| `saveProfile()` | имя/био на сервер | `PATCH /api/me` |
| `renderChats / openChat / renderMessages` | данные с сервера, весь текст через `esc()` | `GET /api/chats`, `GET /api/chats/:id/messages` |
| `sendMessage()` | оптимистичный показ + сервер, **фейковый автоответ «Ok» удалён** | сокет `message:send` (ack), запасной `POST /api/chats/:id/messages` |
| *(новое)* `onIncomingMessage` | входящие в реальном времени | событие `message:new` |
| *(новое)* `startChatWithUser` | кнопка «Написать» (в вёрстке была, а функции не было) | `POST /api/chats/direct` |
| `sendPostToChat()` | пост как сообщение | `message:send` |
| `runSearch()` | пользователи ищутся на сервере | `GET /api/users/search?q=` |
| `openUserProfile()` | имя/био/аватар/галочка с сервера | `GET /api/users/:username` |
| `toggleNotifSetting('messages')` | включает Web Push (по нажатию) | `POST /api/push/subscribe` |
| `togglePrivacy('hideOnline'/'hideRead')` | настройка на сервер | `PATCH /api/me` |

Удалено: `switchTab`, `goToForgotPassword`, `goToLogin`, `sendRecoveryEmail`, `togglePwd`, переменная `authMode`,
захардкоженный аккаунт `mchat / admin123` из `init()`, чтение/запись `mchat_chats` и `mchat_messages` в `localStorage`.

## События сокета (справка)
Клиент → сервер: `message:send {chatId,text,clientId}` (с ack), `chat:read {chatId}`, `typing {chatId,isTyping}`, `app:visibility bool`.
Сервер → клиент: `message:new`, `chat:read`, `typing`, `presence`, `auth:login-code`, `auth:new-device`.
