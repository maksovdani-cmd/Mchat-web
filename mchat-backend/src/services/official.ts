/**
 * Значок официального аккаунта Mchat. Выставляется ТОЛЬКО сервером (поля isSystem/officialKind в БД
 * меняет лишь services/system.ts), клиент его не формирует и подделать не может.
 */
export type OfficialKind = 'SECURITY' | 'NEWS';

export const officialOf = (u: { isSystem?: boolean | null; officialKind?: string | null }): OfficialKind | null =>
  u.isSystem && (u.officialKind === 'SECURITY' || u.officialKind === 'NEWS') ? u.officialKind : null;
