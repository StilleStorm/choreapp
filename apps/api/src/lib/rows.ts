/** Row types and DTO mappers. */
import { describeRecurrence, nextOccurrence, parseRRule, type LocalDate, type Rarity } from '@choreapp/core';
import type { FamilyDto, ItemDto, MemberDto, TaskDto } from '@choreapp/shared';
import type { Env } from '../env.js';
import { all, allIn, first } from './db.js';
import { signedFileUrl } from './files.js';

export interface FamilyRow {
  id: string;
  name: string;
  timezone: string;
  quiet_from: string;
  quiet_to: string;
  reminder_time: string;
  price_common: number;
  price_rare: number;
  price_legendary: number;
  created_at: number;
}

export interface MemberRow {
  id: string;
  family_id: string;
  role: 'parent' | 'child';
  name: string;
  avatar_key: string | null;
  avatar_item_id: string | null;
  frame_item_id: string | null;
  theme: string;
  last_reminder_date: string | null;
  created_at: number;
  removed_at: number | null;
  avatar_item_key: string | null;
  frame_item_key: string | null;
  email: string | null;
  connected: number;
}

export const MEMBER_SELECT = `
  SELECT m.*, ai.image_key AS avatar_item_key, fi.image_key AS frame_item_key, pl.email AS email,
         EXISTS (SELECT 1 FROM session s WHERE s.member_id = m.id AND s.revoked_at IS NULL) AS connected
  FROM member m
  LEFT JOIN item ai ON ai.id = m.avatar_item_id
  LEFT JOIN item fi ON fi.id = m.frame_item_id
  LEFT JOIN parent_login pl ON pl.member_id = m.id`;

export interface TaskRow {
  id: string;
  family_id: string;
  series_id: string;
  title: string;
  icon: string;
  description: string | null;
  points: number;
  shared_mode: 'each' | 'any';
  start_date: string;
  end_date: string | null;
  due_time: string | null;
  recurrence: string | null;
  created_by: string;
  created_at: number;
  archived_at: number | null;
}

export interface ItemRow {
  id: string;
  pack_id: string;
  kind: 'sticker' | 'avatar' | 'frame';
  name: string;
  album: string;
  rarity: Rarity;
  image_key: string;
  price: number | null;
  droppable: number;
  sort: number;
  deleted_at: number | null;
}

export function familyDto(f: FamilyRow): FamilyDto {
  return {
    id: f.id,
    name: f.name,
    timezone: f.timezone,
    quietFrom: f.quiet_from,
    quietTo: f.quiet_to,
    reminderTime: f.reminder_time,
    prices: { common: f.price_common, rare: f.price_rare, legendary: f.price_legendary },
  };
}

export async function memberDto(env: Env, origin: string, m: MemberRow, includeEmail = false): Promise<MemberDto> {
  const avatarKey = m.avatar_item_key ?? m.avatar_key;
  return {
    id: m.id,
    role: m.role,
    name: m.name,
    avatarUrl: avatarKey ? await signedFileUrl(env, origin, avatarKey) : null,
    frameUrl: m.frame_item_key ? await signedFileUrl(env, origin, m.frame_item_key) : null,
    avatarItemId: m.avatar_item_id,
    frameItemId: m.frame_item_id,
    theme: m.theme,
    connected: !!m.connected,
    ...(includeEmail && m.email ? { email: m.email } : {}),
  };
}

export async function loadFamily(env: Env, familyId: string): Promise<FamilyRow> {
  const f = await first<FamilyRow>(env.DB, 'SELECT * FROM family WHERE id = ?', familyId);
  if (!f) throw new Error(`family ${familyId} missing`);
  return f;
}

export async function loadMember(env: Env, memberId: string): Promise<MemberRow | null> {
  return first<MemberRow>(env.DB, `${MEMBER_SELECT} WHERE m.id = ?`, memberId);
}

export async function loadMembers(env: Env, familyId: string): Promise<MemberRow[]> {
  return all<MemberRow>(
    env.DB,
    `${MEMBER_SELECT} WHERE m.family_id = ? AND m.removed_at IS NULL ORDER BY m.role DESC, m.created_at`,
    familyId,
  );
}

export function priceOf(item: Pick<ItemRow, 'price' | 'rarity'>, family: FamilyRow): number | null {
  if (item.price === null) return null;
  if (item.price > 0) return item.price;
  return { common: family.price_common, rare: family.price_rare, legendary: family.price_legendary }[item.rarity];
}

export async function itemDto(env: Env, origin: string, item: ItemRow, family: FamilyRow): Promise<ItemDto> {
  return {
    id: item.id,
    packId: item.pack_id,
    kind: item.kind,
    name: item.name,
    album: item.album,
    rarity: item.rarity,
    imageUrl: await signedFileUrl(env, origin, item.image_key),
    price: priceOf(item, family),
    droppable: !!item.droppable,
  };
}

export async function taskDtos(env: Env, tasks: TaskRow[], today: LocalDate): Promise<TaskDto[]> {
  const assignees = await allIn<{ task_id: string; member_id: string }>(
    env.DB,
    (ph) => `SELECT task_id, member_id FROM task_assignee WHERE task_id IN (${ph})`,
    tasks.map((t) => t.id),
  );
  return tasks.map((t) => {
    const recurrence = parseRRule(t.recurrence);
    return {
      id: t.id,
      seriesId: t.series_id,
      title: t.title,
      icon: t.icon,
      description: t.description,
      points: t.points,
      sharedMode: t.shared_mode,
      startDate: t.start_date,
      endDate: t.end_date,
      dueTime: t.due_time,
      recurrence,
      recurrenceText: describeRecurrence(recurrence),
      assignees: assignees.filter((a) => a.task_id === t.id).map((a) => a.member_id),
      nextDate: nextOccurrence({ recurrence, startDate: t.start_date, endDate: t.end_date }, today),
    };
  });
}
