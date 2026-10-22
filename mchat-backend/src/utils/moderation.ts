/**
 * Автомодерация ников и отображаемых имён.
 *
 * Проверка идёт ПО ВХОЖДЕНИЮ ПОДСТРОКИ, а не по целому слову: «123negr», «xx_negr_xx», «n.e.g.r», «n3gr» — всё блокируется.
 * Чтобы обойти список нельзя было цифрами, символами, повторами букв, «зеркальными» кириллическими буквами
 * или транслитом, строка перед проверкой превращается в несколько нормализованных вариантов:
 *   • без разделителей (точки, дефисы, подчёркивания, пробелы, невидимые символы);
 *   • «leet»: 0→o, 1→i, 3→e, 4→a, 5→s, @→a, $→s …;
 *   • кириллица → латиница (фонетически и «по виду») и латиница → кириллица («по виду»);
 *   • повторяющиеся буквы схлопываются («niiiigger» → «niger»).
 * Слово из списка тоже нормализуется так же, поэтому записывать его нужно в обычном виде.
 *
 * Список можно дополнять без правки кода: переменная окружения BANNED_WORDS_EXTRA (слова через запятую).
 */

/** Слова/корни, которые нельзя использовать в нике и имени. Намеренно только однозначно оскорбительные корни. */
const BASE_WORDS: string[] = [
  // ── расовые и этнические оскорбления ──
  'negr', 'nigger', 'nigga', 'nigr', 'niggr', 'nyga', 'kike', 'chink', 'tranny', 'faggot', 'fagot',
  'негр', 'ниггер', 'нигга', 'ниггр', 'нигр', 'чурка', 'чурки',
  // ── английская брань и оскорбления ──
  'fuck', 'fucker', 'motherfucker', 'cunt', 'bitch', 'whore', 'bullshit', 'asshole', 'cocksucker', 'dickhead', 'pussy',
  'retard', 'rapist', 'pedophile', 'paedophile',
  // ── русская брань (кириллица) ──
  'хуй', 'хуе', 'хуя', 'хуё', 'хуесос', 'хуила', 'пизд', 'пезд', 'ебан', 'ебал', 'ебат', 'ебуч', 'еблан', 'заеб', 'доебал', 'долбоеб',
  'пидор', 'пидар', 'пидр', 'блят', 'блядь', 'бляд', 'сука', 'сучка', 'шлюх', 'мудак', 'мудил', 'гандон', 'гондон', 'залуп',
  'мразь', 'говно', 'дерьмо', 'педофил', 'изнасил',
  // ── русская брань (транслит) ──
  'huy', 'huj', 'xuy', 'xui', 'khuy', 'huesos', 'huila', 'pizd', 'pizdec', 'pezd', 'ebat', 'eban', 'eblan', 'ebal', 'yebat', 'ebanat',
  'blyad', 'blyat', 'suka', 'sukin', 'gandon', 'gondon', 'mudak', 'mudila', 'zalupa', 'pidor', 'pidar', 'pidr',
  'dolboeb', 'dolbaeb', 'shlyuh', 'shluh', 'govno', 'pedofil',
  // ── экстремизм ──
  'нацист', 'hitler', 'гитлер', 'heilhitler',
];

/** Безобидные слова, внутри которых случайно встречается запрещённый корень («скипидар» → «пидар»). */
const ALLOWED = ['скипидар', 'хуанг', 'хуан', 'huang', 'sukhbaatar'];
const ALLOWED_RE = new RegExp(ALLOWED.join('|'), 'g');

// ─────────── нормализация ───────────

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g', '€': 'e', '£': 'l',
};

/** то же для кириллицы: «пи3да», «муд@к», «бл9ть» */
const LEET_CYR: Record<string, string> = {
  '0': 'о', '1': 'и', '!': 'и', '|': 'и', '3': 'е', '4': 'а', '@': 'а', '5': 'с', '$': 'с', '6': 'б', '7': 'т', '8': 'в',
};

/** кириллица → латиница «на слух» */
const CYR_PHONETIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
/** кириллица → латиница «по виду» (х → x, у → y, р → p …) */
const CYR_VISUAL: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', и: 'i', л: 'l', п: 'n', б: 'b', г: 'r', ч: 'ch', ш: 'sh',
};
/** латиница → кириллица «по виду», чтобы поймать русские слова, набранные латинскими буквами */
const LAT_TO_CYR: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
};

const ZERO_WIDTH = /[\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff\u00ad]/g;

function stripMarks(s: string): string {
  // NFKD раскладывает «й» на «и» + бревис (U+0306): бревис оставляем и склеиваем обратно через NFC, чтобы «й» не превратилась в «и»
  return s.normalize('NFKD').replace(/[\u0300-\u0305\u0307-\u036f]/g, '').normalize('NFC');
}

const mapChars = (s: string, map: Record<string, string>) => Array.from(s).map((c) => (c in map ? map[c] : c)).join('');
const collapse = (s: string) => s.replace(/(.)\1+/gu, '$1');
const onlyLetters = (s: string) => s.replace(/[^\p{L}]/gu, '');
const onlyAlnum = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '');

/** Все варианты строки, в которых ищем запрещённые подстроки. */
export function variantsOf(raw: string): string[] {
  const base = stripMarks(raw.toLowerCase().replace(ZERO_WIDTH, '')).replace(/ё/g, 'е').replace(ALLOWED_RE, ' ');
  const seeds = [
    onlyAlnum(base),    // как есть, без разделителей: «123negr» → «123negr»
    onlyLetters(base),  // без цифр: «123negr» → «negr»
    onlyLetters(mapChars(base, LEET)),                                   // leet (латиница): «n3gr» → «negr»
    onlyLetters(mapChars(base, { ...LEET, '1': 'l', '|': 'l' })),
    onlyLetters(mapChars(base, LEET_CYR)),                               // leet (кириллица): «пи3да» → «пиеда»
    onlyLetters(mapChars(base, { ...LEET_CYR, '3': 'з' })),              // «пи3да» → «пизда»
  ];
  const out = new Set<string>();
  for (const s of seeds) {
    if (!s) continue;
    out.add(s);
    out.add(mapChars(s, CYR_PHONETIC));
    out.add(mapChars(s, CYR_VISUAL));
    out.add(mapChars(s, LAT_TO_CYR));
  }
  // схлопываем повторы: «niiiigger» → «niger»
  for (const v of [...out]) out.add(collapse(v));
  return [...out].filter(Boolean);
}

// ─────────── словарь ───────────

function buildWordForms(): { word: string; forms: string[] }[] {
  const extra = (process.env.BANNED_WORDS_EXTRA ?? '').split(',').map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 3);
  const words = [...new Set([...BASE_WORDS, ...extra])];
  return words.map((word) => {
    const forms = new Set<string>();
    const lc = stripMarks(word.toLowerCase()).replace(/ё/g, 'е');
    forms.add(lc);
    // слово из списка приводим теми же преобразованиями, что и проверяемую строку
    forms.add(mapChars(lc, CYR_PHONETIC));
    forms.add(mapChars(lc, CYR_VISUAL));
    for (const f of [...forms]) forms.add(collapse(f));
    return { word, forms: [...forms].filter((f) => f.length >= 3) };
  });
}

const WORDS = buildWordForms();

/** Возвращает найденное запрещённое слово или null. */
export function findForbidden(raw: string): string | null {
  if (!raw) return null;
  const vs = variantsOf(raw);
  for (const { word, forms } of WORDS) {
    for (const v of vs) {
      for (const f of forms) if (v.includes(f)) return word;
    }
  }
  return null;
}

export const isForbidden = (raw: string) => findForbidden(raw) !== null;
