/* Mchat · локализация RU / EN.
 * Приложение написано на русском; при выборе English весь интерфейс (включая динамически созданные окна,
 * тосты и ошибки сервера) переводится «на лету»: словарь + правила для чисел/имён + MutationObserver.
 * При возврате на русский исходные тексты восстанавливаются. Содержимое пользователей (сообщения) не переводится. */
(function () {
  'use strict';
  window.__mxBootSearch = location.search;   // script.js чистит адресную строку — запоминаем ?call=…&chat=… из push

  const DICT = {
"#видео": "#video",
"#жизнь": "#life",
"#рилс": "#reels",
"#фото": "#photo",
"+ История": "+ Story",
". Звонок продолжается без него": ". The call continues without it",
". Осталось попыток:": ". Attempts left:",
". Разрешите его: значок замка слева от адреса сайта → Разрешения. Звонок продолжается без него": ". Allow it: lock icon left of the site address → Permissions. The call continues without it",
"10 дней": "10 days",
"15 дней": "15 days",
"30 дней": "30 days",
"5 дней": "5 days",
"@автор": "@author",
"Enter отправляет сообщение": "Enter sends the message",
"HD: высокое качество, до 2 МБ": "HD: high quality, up to 2 MB",
"HD: до 2560 px": "HD: up to 2560 px",
"Push-уведомления включены": "Push notifications enabled",
"Username нельзя менять": "Username can't be changed",
"[Пост] от @": "[Post] by @",
"[медиа]": "[media]",
"» больше": "» more",
"Аватар не сохранён:": "Avatar not saved:",
"Аватар обновлён": "Avatar updated",
"Админ": "Admin",
"Админ панель": "Admin panel",
"Аккаунт": "Account",
"Аккаунт Mchat": "Mchat account",
"Аккаунт удалён": "Account deleted",
"Анимации": "Animations",
"Архив пуст": "Archive is empty",
"Аудиозвонок": "Audio call",
"Баннер не сохранён:": "Banner not saved:",
"Баннер обновлен!": "Banner updated!",
"Без звука": "Muted",
"Без камеры": "No camera",
"Без названия": "Untitled",
"Без описания": "No description",
"В группе уже максимум участников": "The group already has the maximum number of members",
"В имени нельзя использовать": "Can't use in the name",
"В канале нельзя звонить": "Calls aren't available in channels",
"В канале публикует только владелец": "Only the owner can post in this channel",
"В чат": "To chat",
"Вам понравился пост от": "liked your post by",
"Введи 6 цифр": "Enter 6 digits",
"Введи ник для регистрации": "Enter a username to sign up",
"Введи текст...": "Enter text...",
"Введи этот код на новом устройстве. Если это не ты — никому не сообщай код.": "Enter this code on the new device. If this isn't you — don't share the code with anyone.",
"Верифицирован": "Verified",
"Виден всем пользователям": "Visible to all users",
"Видео": "Video",
"Видео недоступно": "Video unavailable",
"Видеозвонок": "Video call",
"Видеочат": "Video chat",
"Вкл": "On",
"Включить": "Turn on",
"Включить уведомления": "Turn on notifications",
"Включить уведомления?": "Turn on notifications?",
"Владелец": "Owner",
"Владелец не может выйти из группы": "The owner can't leave the group",
"Владелец не может покинуть чат": "The owner can't leave the chat",
"Внешний вид": "Appearance",
"Войди в аккаунт": "Sign in to your account",
"Войти": "Sign in",
"Войти в административный аккаунт Mchat? Подтвердите вход Google-аккаунтом владельца.": "Sign in to the Mchat administrator account? Confirm with the owner’s Google account.",
"Войти через Google": "Sign in with Google",
"Время ответа: до 24 часов": "Response time: up to 24 hours",
"Все данные будут удалены навсегда": "All data will be deleted permanently",
"Вход с нового устройства": "Sign-in from a new device",
"Вход через Google отменён": "Google sign-in was cancelled",
"Входящий видеозвонок": "Incoming video call",
"Входящий звонок": "Incoming call",
"Вчера": "Yesterday",
"Вы вышли из аккаунта": "You have signed out",
"Вы подписаны": "You are following",
"Вы с": "You with",
"Вы станете администратором: публиковать посты сможете только вы, остальные — читать.": "You will be the administrator: only you can publish posts, everyone else can read.",
"Вы уже друзья": "You are already friends",
"Выбери до 3 треков для отображения в профиле": "Choose up to 3 tracks to show in your profile",
"Выбери обложку видео": "Choose a video cover",
"Выбери хотя бы одного человека": "Choose at least one person",
"Выбрано:": "Selected:",
"Выбрать": "Choose",
"Выбрать видео": "Choose video",
"Выбрать из галереи": "Choose from gallery",
"Выдана": "Granted",
"Выдать галочку на:": "Grant a badge for:",
"Выдать галочку по нику": "Grant a badge by username",
"Вызов…": "Calling…",
"Выйти": "Log out",
"Выйти из аккаунта?": "Log out of your account?",
"Выйти из чата?": "Leave this chat?",
"Выкл": "Off",
"Выключить уведомления": "Turn off notifications",
"Галерея": "Gallery",
"Галочка выдана на": "Badge granted for",
"Галочка выдана навсегда": "Badge granted forever",
"Галочка выдаётся по запросу администратором. Расскажи, почему ты достоин верификации.": "The badge is granted by an administrator on request. Tell us why you deserve verification.",
"Галочка снята": "Badge removed",
"Голосовое": "Voice",
"Голосовое сообщение": "Voice message",
"Голосовые": "Voice messages",
"Готово": "Done",
"Группа": "Group",
"Да, удалить": "Yes, delete",
"Действующие галочки (": "Active badges (",
"Динамик": "Speaker",
"Для всех": "For everyone",
"Добавить": "Add",
"Добавить в звонок": "Add to call",
"Добавить в пост": "Add to post",
"Добавить подпись...": "Add a caption...",
"Добавить участника": "Add member",
"Добавить участников": "Add members",
"Добавлено:": "Added:",
"Добавлены 3 стиля для навигации: обычный, матовое стекло и жидкое стекло (Liquid Glass). Mchat растёт!": "3 navigation styles added: regular, frosted glass and Liquid Glass. Mchat is growing!",
"Добавляй хэштеги в свои истории — так тебя найдёт больше людей! #mchat #истории": "Add hashtags to your stories — more people will find you! #mchat #stories",
"Добавлять можно только друзей": "You can only add friends",
"Добавлять можно только людей из твоих контактов": "You can only add people from your contacts",
"Добавь описание или медиа": "Add a description or media",
"Добавь текст или медиа": "Add text or media",
"Добро пожаловать в Mchat!": "Welcome to Mchat!",
"Других людей можно добавить позже, в настройках группы.": "You can add more people later in the group settings.",
"Друзья": "Friends",
"Ещё": "More",
"Завершить звонок": "End call",
"Загружаю распознавание лица…": "Loading face tracking…",
"Загружаю фон…": "Uploading background…",
"Загружаю фото…": "Uploading photo…",
"Загрузить свой трек": "Upload your own track",
"Загрузить фото": "Upload photo",
"Загрузка видео...": "Uploading video...",
"Загрузка фото...": "Uploading photo...",
"Загрузка...": "Loading...",
"Загрузка…": "Loading…",
"Закрепить": "Pin",
"Закреплённое сообщение": "Pinned message",
"Закреплённые треки": "Pinned tracks",
"Закрытый аккаунт": "Private account",
"Закрыть": "Close",
"Запись видео не поддерживается": "Video recording is not supported",
"Запись не поддерживается": "Recording is not supported",
"Заполни поле причины": "Fill in the reason",
"Запрос верификации": "Verification request",
"Запрос отклонён": "Request rejected",
"Запрос отклонён (неверный источник)": "Request rejected (invalid origin)",
"Запрос отправлен администраторам!": "Request sent to the administrators!",
"Запросить верификацию": "Request verification",
"Заявка не найдена": "Request not found",
"Звоним:": "Calling:",
"Звонки не настроены на сервере: добавь ZEGO_APP_ID и ZEGO_SERVER_SECRET в Render": "Calls are not configured on the server: add ZEGO_APP_ID and ZEGO_SERVER_SECRET in Render",
"Звонки работают только по https или на localhost": "Calls only work over https or on localhost",
"Звонок завершён": "Call ended",
"Звонок отклонён": "Call declined",
"Звонок отменён": "Call cancelled",
"Звонок уже завершён": "The call has already ended",
"Звук": "Sound",
"Здесь пока ничего нет": "Nothing here yet",
"Идёт запись…": "Recording…",
"Изменить": "Edit",
"Изменить баннер": "Change banner",
"Изменить сообщение": "Edit message",
"Изменить чат": "Edit chat",
"Имя": "Name",
"Имя можно менять раз в 7 дней": "You can change your name once every 7 days",
"Использовать звук": "Use sound",
"Истории": "Stories",
"История": "Story",
"История не найдена или истекла": "Story not found or expired",
"История опубликована": "Story published",
"История удалена": "Story deleted",
"КБ": "KB",
"Кадрировать аватар": "Crop avatar",
"Камера": "Camera",
"Камера еще загружается": "The camera is still loading",
"Камера не найдена — подключите её": "Camera not found — connect one",
"Камера недоступна": "Camera unavailable",
"Камера недоступна в этом браузере": "Camera is unavailable in this browser",
"Канал": "Channel",
"Каналы": "Channels",
"Ключи ZEGOCLOUD (ZEGO_APP_ID / ZEGO_SERVER_SECRET) не подходят — проверь их в Render": "The ZEGOCLOUD keys (ZEGO_APP_ID / ZEGO_SERVER_SECRET) are invalid — check them in Render",
"Код истёк. Войди через Google заново": "The code has expired. Sign in with Google again",
"Код отправлен на почту": "Code sent to your email",
"Код уже отправлен на почту": "The code has already been sent to your email",
"Комментариев пока нет — будь первым": "No comments yet — be the first",
"Комментарии": "Comments",
"Комментарий отправлен": "Comment sent",
"Комментарий...": "Comment...",
"Контактов пока нет. Напиши кому-нибудь или добавь друга — они появятся здесь": "No contacts yet. Message someone or add a friend — they will appear here",
"Конфиденциальность": "Privacy",
"Копировать": "Copy",
"Корона": "Crown",
"Круглые": "Round",
"Кружок": "Video note",
"Курсив": "Italic",
"Лайк": "Like",
"Лайки": "Likes",
"Личные сообщения": "Direct messages",
"МБ": "MB",
"Максимум 20 треков в профиле": "Maximum of 20 tracks in your profile",
"Максимум 3 закреплённых трека": "Maximum of 3 pinned tracks",
"Максимум 6 историй в день": "Maximum of 6 stories per day",
"Максимум 6 историй в день. Лимит исчерпан.": "Maximum of 6 stories per day. Limit reached.",
"Маркер": "Marker",
"Маска": "Mask",
"Маски": "Masks",
"Масштаб:": "Zoom:",
"Матовое": "Frosted",
"Медиа": "Media",
"Медиа-контент": "Media content",
"Меню чата": "Chat menu",
"Микрофон": "Microphone",
"Микрофон не найден — подключите его": "Microphone not found — connect one",
"Микрофон недоступен в этом браузере": "Microphone is unavailable in this browser",
"Можно закрепить не больше 10 чатов": "You can pin up to 10 chats",
"Можно менять только свои сообщения": "You can only edit your own messages",
"Мои истории": "My stories",
"Музыка": "Music",
"Мы отправили код на": "We sent a code to",
"Мы отправили новый код на твою почту из Google-аккаунта": "We sent a new code to the email of your Google account",
"Навсегда": "Forever",
"Нажми для замены": "Tap to replace",
"Нажми, чтобы добавить текст": "Tap to add text",
"Назад": "Back",
"Название группы": "Group name",
"Название канала": "Channel name",
"Название трека": "Track title",
"Написать": "Message",
"Написать комментарий...": "Write a comment...",
"Написать реакцию...": "Write a reaction...",
"Напиши нам если что-то не работает:": "Write to us if something isn't working:",
"Напиши описание... #хэштег": "Write a caption... #hashtag",
"Настройки": "Settings",
"Настройки группы": "Group settings",
"Настройки канала": "Channel settings",
"Начни вводить запрос": "Start typing a query",
"Не найдено": "Not found",
"Не сейчас": "Not now",
"Не удалось вернуть камеру": "Could not restore the camera",
"Не удалось включить камеру": "Could not turn on the camera",
"Не удалось включить маски. Звонок продолжается без них": "Could not turn on masks. The call continues without them",
"Не удалось включить микрофон": "Could not turn on the microphone",
"Не удалось включить микрофон или камеру. Проверьте разрешения в браузере. Звонок продолжается без них": "Could not turn on the microphone or camera. Check the browser permissions. The call continues without them",
"Не удалось войти через Google. Попробуй ещё раз": "Could not sign in with Google. Please try again",
"Не удалось воспроизвести": "Could not play",
"Не удалось загрузить": "Could not load",
"Не удалось загрузить список": "Could not load the list",
"Не удалось отправить письмо": "Could not send the email",
"Не удалось передать звук/видео (код": "Could not send audio/video (code",
"Не удалось переключить камеру": "Could not switch the camera",
"Не удалось подключиться к звонку": "Could not connect to the call",
"Не удалось показать экран": "Could not share the screen",
"Не удалось поставить эту аватарку": "Could not set this avatar",
"Не удалось прикрепить файл, попробуй ещё раз": "Could not attach the file, please try again",
"Не удалось принять поток собеседника (код": "Could not receive the other person's stream (code",
"Не удалось скачать видео": "Could not download the video",
"Не удалось скопировать": "Could not copy",
"Не удалось удалить аккаунт:": "Could not delete the account:",
"Неверный код": "Invalid code",
"Неверный срок": "Invalid duration",
"Недопустимая реакция": "Invalid reaction",
"Недостаточно прав": "Not enough permissions",
"Некому звонить": "Nobody to call",
"Некорректные данные": "Invalid data",
"Нельзя добавить в друзья самого себя": "You can't add yourself as a friend",
"Нельзя использовать чужой файл": "You can't use someone else's file",
"Нельзя писать самому себе": "You can't message yourself",
"Нельзя репостить свой пост": "You can't repost your own post",
"Нет": "No",
"Нет активности. Прокомментируй или репостни посты!": "No activity. Comment on or repost posts!",
"Нет активных чатов": "No active chats",
"Нет видео для скачивания": "No video to download",
"Нет доступа к камере": "No access to the camera",
"Нет доступа к микрофону": "No access to the microphone",
"Нет доступа к устройствам? Отправить код на почту": "No access to your devices? Send the code by email",
"Нет контактов": "No contacts",
"Нет новых запросов": "No new requests",
"Нет постов. Напиши первый!": "No posts. Write the first one!",
"Нет связи с сервером": "No connection to the server",
"Нет соединения / No connection": "No connection",
"Нет сообщений": "No messages",
"Нет чатов": "No chats",
"Нет чатов для пересылки": "No chats to forward to",
"Ник нужен только при регистрации. Если аккаунт уже есть — просто нажми кнопку.": "A username is only needed to sign up. If you already have an account — just press the button.",
"Ник: 3–20 символов, латиница, цифры и _": "Username: 3–20 characters, Latin letters, digits and _",
"Ник: максимум 20 символов": "Username: 20 characters maximum",
"Ник: минимум 3 символа": "Username: at least 3 characters",
"Ник: только латиница, цифры и _": "Username: only Latin letters, digits and _",
"Никто не ответил": "No one answered",
"Ничего не найдено": "Nothing found",
"Ничего нет": "Nothing here",
"Новая группа": "New group",
"Новое обновление": "New update",
"Новости и обновления": "News and updates",
"Новые запросы (": "New requests (",
"Новый вход в аккаунт:": "New sign-in to your account:",
"Новый канал": "New channel",
"Новый пользователь": "New user",
"Новый пост": "New post",
"Нужно название": "A title is required",
"О себе": "About",
"Обложка видео": "Video cover",
"Обложка выбрана": "Cover selected",
"Обычное качество: до 1280 px": "Standard quality: up to 1280 px",
"Обычное качество: до 200 КБ": "Standard quality: up to 200 KB",
"Обычный": "Regular",
"Ожидание…": "Waiting…",
"Онлайн": "Online",
"Опиши проблему — сообщение придёт в чат с администратором Mchat, ответ будет там же.": "Describe the problem — your message will go to a chat with the Mchat administrator, and the reply will appear there.",
"Опубликовать": "Publish",
"Опубликовать историю": "Publish story",
"Оригинальный звук": "Original sound",
"Остановить": "Stop",
"Ответ": "Reply",
"Ответить": "Reply",
"Отклонить": "Decline",
"Открепить": "Unpin",
"Открываю редактор с этим звуком…": "Opening the editor with this sound…",
"Отмена": "Cancel",
"Отписаться?": "Unfollow?",
"Отписаться? Вы перестанете быть друзьями": "Unfollow? You'll no longer be friends",
"Отписка оформлена": "Unfollowed",
"Отправить": "Send",
"Отправить в чат": "Send to chat",
"Отправка видео…": "Sending video…",
"Отправка на почту отключена": "Sending email is disabled",
"Официальный канал": "Official channel",
"Официальный канал · Только чтение": "Official channel · Read-only",
"Очистить": "Clear",
"Очки": "Glasses",
"Ошибка безопасности входа. Попробуй ещё раз": "Sign-in security error. Please try again",
"Перевернуть камеру": "Flip camera",
"Перемотай до нужного кадра": "Scrub to the frame you want",
"Переслано": "Forwarded",
"Переслано от": "Forwarded from",
"Переслать": "Forward",
"Переслать в…": "Forward to…",
"Переснять": "Retake",
"Переходим в Google…": "Redirecting to Google…",
"По этому запросу уже принято решение": "A decision has already been made on this request",
"Поделиться": "Share",
"Подписаться": "Follow",
"Подписаться в ответ": "Follow back",
"Подписка оформлена": "Followed",
"Подписки": "Following",
"Подписчики": "Followers",
"Подтверди вход": "Confirm sign-in",
"Подтвердить": "Confirm",
"Позвонить": "Call",
"Поиск": "Search",
"Пока нет загруженных треков": "No uploaded tracks yet",
"Пока нет комментариев. Будь первым!": "No comments yet. Be the first!",
"Пока нет постов": "No posts yet",
"Пока нет репостов": "No reposts yet",
"Пока никому не выдана": "Not granted to anyone yet",
"Показ экрана не поддерживается на этом устройстве": "Screen sharing is not supported on this device",
"Показать экран": "Share screen",
"Покинуть": "Leave",
"Пользователи": "Users",
"Пользователь": "User",
"Пользователь не найден": "User not found",
"Помощь": "Help",
"Понятно": "Got it",
"Пост не найден или удалён": "Post not found or deleted",
"Пост опубликован!": "Post published!",
"Пост отправлен в чат": "Post sent to chat",
"Пост удалён": "Post deleted",
"Посты": "Posts",
"Привет! Я в Mchat ✨": "Hi! I'm on Mchat ✨",
"Прикрепить файл": "Attach file",
"Применить": "Apply",
"Принять": "Accept",
"Присоединиться": "Join",
"Прокомментировать": "Comment",
"Пропущенный звонок": "Missed call",
"Прослушать": "Listen",
"Профиль": "Profile",
"Публикации в этом канале доступны только владельцу и админам": "Only the owner and admins can post in this channel",
"Публикация...": "Publishing...",
"Публикую…": "Publishing…",
"Публичный канал (его можно найти в поиске)": "Public channel (can be found in search)",
"Пустое сообщение": "Empty message",
"Работаю": "Working",
"Разреши уведомления в настройках браузера": "Allow notifications in your browser settings",
"Реакция отправлена": "Reaction sent",
"Редактировать": "Edit",
"Редактировать профиль": "Edit profile",
"Репост": "Repost",
"Репост опубликован!": "Repost published!",
"Репосты": "Reposts",
"Рожки": "Horns",
"Роль владельца изменить нельзя": "The owner's role can't be changed",
"Русский": "Russian",
"Сбросить фон": "Reset background",
"Связь прервалась": "Connection lost",
"Сегодня": "Today",
"Сервис звонков ZEGOCLOUD сейчас недоступен, попробуй позже": "The ZEGOCLOUD calling service is unavailable right now, try again later",
"Сессия": "Session",
"Сессия завершена. Войди снова": "Session ended. Sign in again",
"Сессия истекла. Войди снова": "Session expired. Sign in again",
"Сжимаю видео…": "Compressing video…",
"Скачать": "Download",
"Скачивание началось": "Download started",
"Скопировано": "Copied",
"Скопировать": "Copy",
"Скопировать ссылку-приглашение": "Copy invite link",
"Скрыть посты от чужих": "Hide posts from strangers",
"Скрыть прочитанность": "Hide read status",
"Скрыть статус «онлайн»": "Hide “online” status",
"Слишком много попыток. Подожди 15 минут": "Too many attempts. Wait 15 minutes",
"Слишком много разных реакций": "Too many different reactions",
"Слишком часто. Подожди немного": "Too often. Wait a moment",
"Слушать": "Listen",
"Сменить камеру": "Switch camera",
"Сменить фон": "Change background",
"Сменить фото": "Change photo",
"Смотри это видео в Mchat!": "Watch this video on Mchat!",
"Сначала включи камеру": "Turn on the camera first",
"Сначала дождись соединения": "Wait for the connection first",
"Снять": "Remove",
"Снять галочку досрочно": "Remove badge early",
"Снять галочку досрочно?": "Remove the badge early?",
"Собеседник": "Contact",
"Совет дня": "Tip of the day",
"Создать": "Create",
"Создать группу": "Create group",
"Создать группу или канал": "Create a group or channel",
"Создать канал": "Create channel",
"Сообщение не найдено": "Message not found",
"Сообщение отправлено": "Message sent",
"Сообщение слишком длинное (максимум 4000 символов)": "Message is too long (4000 characters maximum)",
"Сообщение удалено": "Message deleted",
"Сообщение...": "Message...",
"Сообщения": "Messages",
"Сохранено в избранное": "Saved to favorites",
"Сохранить": "Save",
"Сохранить в избранное": "Save to favorites",
"Сохранённые звуки из Reels": "Saved sounds from Reels",
"Ссылка": "Link",
"Ссылка скопирована": "Link copied",
"Ссылка-приглашение недействительна": "The invite link is invalid",
"Ссылки": "Links",
"Стиль": "Style",
"Стиль острова": "Island style",
"Так вам придут новые сообщения, звонки и код для входа с нового устройства, даже когда Mchat закрыт.": "You will receive new messages, calls and the sign-in code for a new device even when Mchat is closed.",
"Твой запрос уже на рассмотрении": "Your request is already under review",
"Текст": "Text",
"Тема": "Theme",
"Теперь вы друзья": "You are now friends",
"Техническая поддержка": "Technical support",
"Техподдержка": "Support",
"Техподдержка сейчас недоступна, попробуй позже": "Support is unavailable right now, try again later",
"Только администраторы могут писать сюда": "Only administrators can write here",
"Только для меня": "Only for me",
"Только ты видишь этот пост": "Only you can see this post",
"Только чтение": "Read-only",
"Трек": "Track",
"Трек загружен": "Track uploaded",
"Трек показан в профиле": "Track shown in your profile",
"Трек убран из профиля": "Track removed from your profile",
"Ты ещё не лайкал посты": "You haven't liked any posts yet",
"Ты репостнул": "You reposted",
"Ты уже в другом звонке": "You're already in another call",
"Ты уже в звонке": "You're already in a call",
"Ты уже репостил этот пост": "You already reposted this post",
"Тёплый": "Warm",
"У тебя уже есть галочка": "You already have a badge",
"Уведомлений пока нет": "No notifications yet",
"Уведомления": "Notifications",
"Уведомления включены": "Notifications enabled",
"Уведомления выключены": "Notifications turned off",
"Уведомления:": "Notifications:",
"Удалено из избранного": "Removed from favorites",
"Удалить": "Delete",
"Удалить (": "Delete (",
"Удалить аккаунт": "Delete account",
"Удалить аккаунт?": "Delete account?",
"Удалить запись": "Delete recording",
"Удалить из избранного": "Remove from favorites",
"Удалить историю?": "Delete story?",
"Удалить навсегда": "Delete permanently",
"Удалить пост?": "Delete post?",
"Удалить сообщение только у вас?": "Delete the message for you only?",
"Удалить сообщение у всех?": "Delete the message for everyone?",
"Удалить трек из профиля?": "Remove the track from your profile?",
"Удалить у всех": "Delete for everyone",
"Удалить у меня": "Delete for me",
"Удалить участника?": "Remove member?",
"Усы": "Mustache",
"Участник": "Member",
"Участник не найден": "Member not found",
"Участники": "Members",
"Участники из контактов": "Members from contacts",
"Файл": "File",
"Файл не найден": "File not found",
"Файл недоступен": "File unavailable",
"Файл пустой": "The file is empty",
"Файл слишком большой": "The file is too large",
"Фон чата": "Chat background",
"Фото": "Photo",
"Фото из галереи": "Photo from gallery",
"Фото из моего профиля": "Photo from my profile",
"Фото обновлено": "Photo updated",
"Фото профиля": "Profile photo",
"Фото сделано!": "Photo taken!",
"Фото/видео": "Photo/video",
"Холодный": "Cool",
"Ч/Б": "B/W",
"Чат": "Chat",
"Чат не найден": "Chat not found",
"Чаты": "Chats",
"Что нового?": "What's new?",
"Что-то пошло не так. Попробуй ещё раз": "Something went wrong. Please try again",
"Это действие нельзя отменить": "This action can't be undone",
"Это личный чат": "This is a private chat",
"Это новое устройство. Мы отправили код на твою почту и на устройства, где ты уже вошёл в Mchat": "This is a new device. We sent a code to your email and to the devices where you're already signed in to Mchat",
"Это официальный канал новостей. Здесь будут выходить обновления, анонсы и важная информация.": "This is the official news channel. Updates, announcements and important information will appear here.",
"Это первое видео": "This is the first video",
"Это сообщение нельзя изменить": "This message can't be edited",
"Этот Google-аккаунт не имеет доступа к аккаунту Mchat": "This Google account doesn't have access to the Mchat account",
"Этот Google-аккаунт уже связан с другим профилем": "This Google account is already linked to another profile",
"Этот браузер не поддерживает push-уведомления": "This browser doesn't support push notifications",
"Этот ник зарезервирован": "This username is reserved",
"Этот ник уже занят — выбери другой": "This username is already taken — choose another",
"Этот формат файла не поддерживается": "This file format is not supported",
"Язык": "Language",
"был(а)": "last seen",
"дн.": "d.",
"исчезнет": "expires",
"на": "for",
"навсегда": "forever",
"онлайн": "online",
"печатает…": "typing…",
"подписался(ась) на вас": "started following you",
"подписчик": "follower",
"подписчика": "followers",
"подписчиков": "followers",
"ред.": "edited",
"себе": "yourself",
"собеседнику": "the other person",
"теперь друзья": "now friends",
"устройство": "device",
"участник": "member",
"участника": "members",
"участников": "members",
"ч осталось": "h left",
"✓ одобрено": "✓ approved",
"✗ отклонено": "✗ rejected",
"🎤 Голосовое": "🎤 Voice",
"🎤 Голосовое сообщение": "🎤 Voice message",
"🎥 Видеосообщение": "🎥 Video message",
"🎬 Видео": "🎬 Video",
"👑 Админ панель верификации": "👑 Verification admin panel",
"📷 Фото": "📷 Photo"
};
  const CY = /[А-Яа-яЁё]/;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  // ключи-префиксы: «<ключ> <что-то динамическое>»
  const PREFIX_KEYS = Object.keys(DICT).filter((k) => /[:(@]$/.test(k) || / (от|на)$/.test(k) || k.length >= 18 || k === 'Вы с' || k === 'Ты репостнул' || k === 'Переслано от')
    .sort((a, b) => b.length - a.length);

  const RULES = [
    [/^(\d+) ч осталось$/, (m) => m[1] + 'h left'],
    [/^(\d+) подписчик(?:а|ов)?$/, (m) => plural(+m[1], 'follower', 'followers')],
    [/^(\d+) участник(?:а|ов)?$/, (m) => plural(+m[1], 'member', 'members')],
    [/^(\d+) дн\.$/, (m) => m[1] + ' d.'],
    [/^(\d+) дней$/, (m) => m[1] + ' days'],
    [/^был\(а\) (.+)$/, (m) => 'last seen ' + tr(m[1])],
    [/^Новые запросы \((\d+)\)$/, (m) => 'New requests (' + m[1] + ')'],
    [/^Действующие галочки \((\d+)\)$/, (m) => 'Active badges (' + m[1] + ')'],
    [/^Удалить \((\d+)\)$/, (m) => 'Delete (' + m[1] + ')'],
    [/^Галочка выдана на (\d+) дн\.$/, (m) => 'Badge granted for ' + m[1] + ' d.'],
    [/^Выдана (\S+) · исчезнет (\S+)$/, (m) => 'Granted ' + m[1] + ' · expires ' + m[2]],
    [/^Выдана (\S+) · навсегда$/, (m) => 'Granted ' + m[1] + ' · forever'],
    [/^✓ одобрено на (\d+) дн\.$/, (m) => '✓ approved for ' + m[1] + ' d.'],
    [/^✓ одобрено навсегда$/, () => '✓ approved forever'],
    [/^@(\S+) — (.+?) · (\S+)$/, (m) => '@' + m[1] + ' — ' + tr(m[2]) + ' · ' + m[3]],
    [/^«(.+)» больше (\d+) МБ$/, (m) => '“' + m[1] + '” is larger than ' + m[2] + ' MB'],
    [/^(.+) подписался\(ась\) на вас$/, (m) => m[1] + ' started following you'],
    [/^(.+) теперь друзья$/, (m) => m[1] + ' are now friends'],
    [/^(.+) \(код (.+)\)$/, (m) => tr(m[1]) + ' (code ' + m[2] + ')'],
    [/^Мы отправили код на (.+)$/, (m) => 'We sent a code to ' + m[1]],
    [/^(\d+) КБ$/, (m) => m[1] + ' KB'],
    [/^(.+) МБ$/, (m) => /^[\d.,]+$/.test(m[1]) ? m[1] + ' MB' : null],
  ];

  function translateCore(core) {
    if (DICT[core] !== undefined) return DICT[core];
    for (const [re, fn] of RULES) { const m = core.match(re); if (m) { const r = fn(m); if (r != null) return r; } }
    for (const k of PREFIX_KEYS) {
      if (core.length > k.length && core.startsWith(k)) {
        const rest = core.slice(k.length);
        if (!CY.test(rest.charAt(0))) return DICT[k] + rest;      // «Ключ: Имя», «Ключ (код 5)»
      }
    }
    return null;
  }
  /** Перевод одного текста интерфейса (пробелы по краям сохраняются). null — перевода нет. */
  function tr(text) {
    if (!CY.test(text)) return text;
    const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
    const r = translateCore(norm(text));
    return r == null ? null : lead + r + trail;
  }

  // Для системных сообщений (тосты/ошибки): если целиком не нашли — заменяем известные фразы внутри строки (только целые слова)
  let SUBS = null;
  function subs() {
    if (SUBS) return SUBS;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    SUBS = Object.keys(DICT).filter((k) => k.length >= 3).sort((a, b) => b.length - a.length)
      .map((k) => [new RegExp('(?<![А-Яа-яЁё])' + esc(k) + '(?![А-Яа-яЁё])', 'g'), DICT[k]]);
    return SUBS;
  }
  function tx(s) {
    s = String(s);
    if (I18N.lang !== 'en' || !CY.test(s)) return s;
    const full = tr(s);
    if (full != null && !CY.test(full)) return full;
    let out = full != null ? full : s;
    for (const [re, en] of subs()) { if (!CY.test(out)) break; out = out.replace(re, en); }
    return out;
  }

  /* ───────── DOM ───────── */
  const ORIG = new WeakMap();          // текстовый узел → русский оригинал
  const ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];
  const SKIP = 'script,style,textarea,.mx-txt,[data-notr],#messages-container .mx-sender';

  function skip(el) { return !el || (el.closest && el.closest(SKIP)); }

  function doText(node) {
    const v = node.nodeValue;
    if (I18N.lang === 'en') {
      if (!CY.test(v) || skip(node.parentElement)) return;
      const r = tr(v);
      if (r != null && r !== v) { ORIG.set(node, v); node.nodeValue = r; }
    } else if (ORIG.has(node) && !CY.test(v)) {
      node.nodeValue = ORIG.get(node); ORIG.delete(node);
    }
  }
  function doAttrs(el) {
    if (el.closest && el.closest('[data-notr]')) return;   // placeholder/title — тоже системные, даже у textarea
    for (const a of ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      const v = el.getAttribute(a);
      const store = el.__mxOrig || (el.__mxOrig = {});
      if (I18N.lang === 'en') {
        if (!CY.test(v)) continue;
        const r = tr(v);
        if (r != null && r !== v) { store[a] = v; el.setAttribute(a, r); }
      } else if (store[a] !== undefined && !CY.test(v)) { el.setAttribute(a, store[a]); delete store[a]; }
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = tw.nextNode())) doText(n);
    root.querySelectorAll('[placeholder],[title],[alt],[aria-label]').forEach(doAttrs);
  }

  let observer = null, busy = false;
  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver((muts) => {
      if (I18N.lang !== 'en' || busy) return;
      busy = true;
      try {
        for (const m of muts) {
          if (m.type === 'childList') m.addedNodes.forEach(walk);
          else if (m.type === 'characterData') doText(m.target);
          else if (m.type === 'attributes') doAttrs(m.target);
        }
      } finally { busy = false; }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  const I18N = {
    lang: (function () { try { return localStorage.getItem('mchat_lang') === 'en' ? 'en' : 'ru'; } catch (e) { return 'ru'; } })(),
    t: tr, tx,
    set(lang) {
      this.lang = lang === 'en' ? 'en' : 'ru';
      try { localStorage.setItem('mchat_lang', this.lang); } catch (e) {}
      document.documentElement.lang = this.lang;
      if (document.body) { busy = true; try { walk(document.body); } finally { busy = false; } }
      startObserver();
    },
    /** Вызывается после загрузки script.js: подключаем перевод к тостам, ошибкам и переключателю языка. */
    install() {
      const st = window.showToast;
      if (st && !st.__i18n) { const w = function (m) { return st.call(this, I18N.tx(m)); }; w.__i18n = true; window.showToast = w; }
      if (window.MchatAPI && MchatAPI.errorText && !MchatAPI.errorText.__i18n) {
        const et = MchatAPI.errorText; const w = function (e) { return I18N.tx(et.call(this, e)); }; w.__i18n = true; MchatAPI.errorText = w;
      }
      window.switchLanguage = function () {
        currentLanguage = I18N.lang === 'ru' ? 'en' : 'ru';
        I18N.set(currentLanguage);
        const lbl = document.getElementById('current-language');
        if (lbl) lbl.textContent = currentLanguage === 'en' ? 'English' : 'Русский';
      };
      currentLanguage = I18N.lang;
      const lbl = document.getElementById('current-language');
      if (lbl) lbl.textContent = I18N.lang === 'en' ? 'English' : 'Русский';
      I18N.set(I18N.lang);
    },
  };
  window.I18N = I18N;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { document.documentElement.lang = I18N.lang; startObserver(); });
  else { document.documentElement.lang = I18N.lang; startObserver(); }
})();
