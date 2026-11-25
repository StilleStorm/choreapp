/**
 * Which packs and items a family can use. Built-in packs (family_id NULL)
 * are shared; each family can switch them off via pack_setting. A pack the
 * family added itself has its own `active` flag.
 */
import { all, first } from '../lib/db.js';
import type { ItemRow } from '../lib/rows.js';

export const ACTIVE_PACKS = `
  SELECT p.id FROM pack p
  LEFT JOIN pack_setting ps ON ps.pack_id = p.id AND ps.family_id = ?1
  WHERE (p.family_id = ?1 OR p.family_id IS NULL) AND COALESCE(ps.active, p.active) = 1`;

export async function activeItems(db: D1Database, familyId: string, kind?: ItemRow['kind']): Promise<ItemRow[]> {
  return all<ItemRow>(
    db,
    `SELECT i.* FROM item i
      WHERE i.deleted_at IS NULL AND i.pack_id IN (${ACTIVE_PACKS}) ${kind ? 'AND i.kind = ?2' : ''}
      ORDER BY i.album, i.sort, i.name`,
    ...(kind ? [familyId, kind] : [familyId]),
  );
}

/** Stickers that can still drop for this child: droppable, active, not owned. */
export async function dropPool(db: D1Database, familyId: string, memberId: string): Promise<ItemRow[]> {
  return all<ItemRow>(
    db,
    `SELECT i.* FROM item i
      WHERE i.deleted_at IS NULL AND i.kind = 'sticker' AND i.droppable = 1
        AND i.pack_id IN (${ACTIVE_PACKS})
        AND NOT EXISTS (SELECT 1 FROM member_item mi WHERE mi.member_id = ?2 AND mi.item_id = i.id)`,
    familyId,
    memberId,
  );
}

export async function stickerCounts(db: D1Database, familyId: string, memberId: string): Promise<{ owned: number; total: number }> {
  const r = await first<{ owned: number; total: number }>(
    db,
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN EXISTS (SELECT 1 FROM member_item mi WHERE mi.member_id = ?2 AND mi.item_id = i.id) THEN 1 ELSE 0 END) AS owned
       FROM item i
      WHERE i.deleted_at IS NULL AND i.kind = 'sticker' AND i.pack_id IN (${ACTIVE_PACKS})`,
    familyId,
    memberId,
  );
  return { owned: r?.owned ?? 0, total: r?.total ?? 0 };
}
