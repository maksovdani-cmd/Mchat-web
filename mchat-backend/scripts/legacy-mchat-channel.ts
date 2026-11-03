/**
 * Старый канал «Mchat» (только для чтения) заменён двумя официальными аккаунтами. Этот скрипт НИЧЕГО не удаляет.
 *
 *   npx tsx scripts/legacy-mchat-channel.ts
 *       Пробный прогон (по умолчанию): только ЧИТАЕТ БД и печатает кандидатов — каналы, похожие на старый «Mchat»
 *       (владелец, участники, число сообщений, даты). Ничего не меняет.
 *
 *   npx tsx scripts/legacy-mchat-channel.ts --apply --chat <id>
 *       Для ОДНОГО канала, id которого ты выбрал вручную: скрывает его у всех участников (hiddenAt)
 *       и убирает из публичного поиска (isPublic=false). Сообщения, файлы и участники остаются нетронутыми.
 *       Канал не удаляется; автоматически скрипт сам ничего не выбирает.
 *
 *   npx tsx scripts/legacy-mchat-channel.ts --restore --chat <id> [--public]
 *       Откат: возвращает канал в списки участников (hiddenAt=null); с --public — снова публичный.
 *
 * Запускать там, где доступна рабочая БД (Render → Shell сервиса). Перед --apply сделай бэкап БД.
 */
import { prisma } from '../src/db';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (n: string) => process.argv.includes(n);

async function main() {
  const chatId = arg('--chat');
  if (has('--apply') || has('--restore')) {
    if (!chatId) throw new Error('Укажи канал: --chat <id> (id берётся из пробного прогона)');
    const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { id: true, type: true, title: true, isPublic: true } });
    if (!chat || chat.type !== 'CHANNEL') throw new Error('Канал с таким id не найден (или это не канал) — ничего не изменено');
    if (has('--apply')) {
      const hidden = await prisma.chatMember.updateMany({ where: { chatId }, data: { hiddenAt: new Date() } });
      await prisma.chat.update({ where: { id: chatId }, data: { isPublic: false } });
      console.log(`Канал «${chat.title}» (${chatId}) скрыт у ${hidden.count} участников и убран из публичного поиска (был публичным: ${chat.isPublic}). Данные не удалены.`);
      console.log(`Откат: npx tsx scripts/legacy-mchat-channel.ts --restore --chat ${chatId}${chat.isPublic ? ' --public' : ''}`);
    } else {
      const shown = await prisma.chatMember.updateMany({ where: { chatId }, data: { hiddenAt: null } });
      if (has('--public')) await prisma.chat.update({ where: { id: chatId }, data: { isPublic: true } });
      console.log(`Канал «${chat.title}» возвращён участникам: ${shown.count}${has('--public') ? ', снова публичный' : ''}.`);
    }
    await prisma.$disconnect();
    return;
  }

  // ── пробный прогон ──
  const rows = await prisma.chat.findMany({
    where: {
      type: 'CHANNEL',
      OR: [
        { title: { contains: 'mchat', mode: 'insensitive' } },
        { members: { some: { role: 'OWNER', user: { username: 'mchat' } } } },
      ],
    },
    select: {
      id: true, title: true, isPublic: true, createdAt: true, lastMessageAt: true,
      _count: { select: { members: true, messages: true } },
      members: { where: { role: 'OWNER' }, select: { user: { select: { username: true, name: true } } }, take: 1 },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log('ПРОБНЫЙ ПРОГОН — ничего не изменено.\n');
  if (!rows.length) console.log('Кандидатов не найдено.');
  for (const c of rows) {
    const owner = c.members[0]?.user;
    console.log(`id: ${c.id}\n  название: «${c.title}»  публичный: ${c.isPublic}\n  владелец: ${owner ? '@' + owner.username + ' (' + owner.name + ')' : '—'}\n  участников: ${c._count.members}, сообщений: ${c._count.messages}\n  создан: ${c.createdAt.toISOString()}, последнее сообщение: ${c.lastMessageAt.toISOString()}\n`);
  }
  console.log('Выбери нужный id и скажи его — тогда: npx tsx scripts/legacy-mchat-channel.ts --apply --chat <id>');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await prisma.$disconnect(); process.exit(1); });
