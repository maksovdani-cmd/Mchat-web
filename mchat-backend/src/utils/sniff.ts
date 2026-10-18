/**
 * Проверка «магических байтов»: заявленный клиентом MIME-тип должен совпасть с настоящим началом файла.
 * Защита от загрузки HTML/SVG/скриптов под видом картинки или аудио (stored XSS, подмена типа).
 * Документы (application/octet-stream) не проверяются — они отдаются только как скачиваемые, в песочнице.
 */
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('latin1');

export function sniffMatchesMime(mime: string, head: Buffer): boolean {
  if (mime === 'application/octet-stream') return true;
  if (head.length < 4) return false;
  switch (mime) {
    case 'image/jpeg': return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/png': return head[0] === 0x89 && ascii(head, 1, 4) === 'PNG';
    case 'image/gif': return ascii(head, 0, 4) === 'GIF8';
    case 'image/webp': return ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP';
    case 'audio/webm':
    case 'video/webm': return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    case 'audio/ogg': return ascii(head, 0, 4) === 'OggS';
    case 'audio/flac': return ascii(head, 0, 4) === 'fLaC';
    case 'audio/wav':
    case 'audio/x-wav': return ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WAVE';
    case 'audio/mpeg':
    case 'audio/mp3': return ascii(head, 0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    case 'audio/aac': return head[0] === 0xff && (head[1] & 0xf0) === 0xf0 || ascii(head, 0, 3) === 'ID3';
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'video/mp4':
    case 'video/quicktime': {
      if (head.length < 8) return false;
      return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(head, 4, 8));
    }
    default: return false; // неизвестный тип — не пускаем
  }
}
