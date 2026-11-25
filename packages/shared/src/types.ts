/** Response shapes returned by the API. */
import type { ChildTaskState, LocalDate, LocalTime, Rarity, Recurrence } from '@choreapp/core';

export type Role = 'parent' | 'child';

export interface ApiError {
  error: string;
  message?: string;
}

export interface FamilyDto {
  id: string;
  name: string;
  timezone: string;
  quietFrom: LocalTime;
  quietTo: LocalTime;
  reminderTime: LocalTime;
  prices: Record<Rarity, number>;
}

export interface MemberDto {
  id: string;
  role: Role;
  name: string;
  /** Signed URL of the avatar image (photo or item), or null for initials. */
  avatarUrl: string | null;
  frameUrl: string | null;
  avatarItemId: string | null;
  frameItemId: string | null;
  theme: string;
  email?: string;
  /** Whether a phone is currently logged in to this profile. */
  connected?: boolean;
}

export interface SessionDto {
  token: string;
  me: MemberDto;
  family: FamilyDto;
}

export interface MeDto {
  me: MemberDto;
  family: FamilyDto;
  members: MemberDto[];
  /** Server clock and today's date in the family zone, so the app needs no clock of its own. */
  now: number;
  today: LocalDate;
}

export interface InviteDto {
  id: string;
  role: Role;
  memberId: string | null;
  memberName: string | null;
  code: string;
  token: string;
  /** Payload encoded in the QR code. */
  qr: string;
  expiresAt: number;
}

export interface InviteSummaryDto {
  id: string;
  role: Role;
  memberId: string | null;
  memberName: string | null;
  expiresAt: number;
}

export interface InviteInfoDto {
  kind: 'join' | 'reconnect' | 'reset';
  role: Role;
  familyName: string;
  memberName: string | null;
}

export interface TaskDto {
  id: string;
  seriesId: string;
  title: string;
  icon: string;
  description: string | null;
  points: number;
  sharedMode: 'each' | 'any';
  startDate: LocalDate;
  endDate: LocalDate | null;
  dueTime: LocalTime | null;
  recurrence: Recurrence;
  recurrenceText: string;
  assignees: string[];
  nextDate: LocalDate | null;
}

export interface AgendaChildDto {
  memberId: string;
  state: ChildTaskState;
  canReport: boolean;
  completionId: string | null;
  reportedAt: number | null;
  rejection: { comment: string | null; at: number } | null;
}

export interface AgendaItemDto {
  occurrenceId: string;
  taskId: string;
  seriesId: string;
  date: LocalDate;
  title: string;
  icon: string;
  description: string | null;
  points: number;
  sharedMode: 'each' | 'any';
  dueTime: LocalTime | null;
  recurring: boolean;
  children: AgendaChildDto[];
}

export interface AgendaDto {
  today: LocalDate;
  now: number;
  items: AgendaItemDto[];
}

export interface ApprovalDto {
  completionId: string;
  occurrenceId: string;
  memberId: string;
  memberName: string;
  title: string;
  icon: string;
  points: number;
  date: LocalDate;
  reportedAt: number;
  late: boolean;
}

export interface ItemDto {
  id: string;
  packId: string;
  kind: 'sticker' | 'avatar' | 'frame';
  name: string;
  album: string;
  rarity: Rarity;
  imageUrl: string;
  /** Effective price, or null when only available from drops. */
  price: number | null;
  droppable: boolean;
  owned?: boolean;
}

export interface DropResultDto {
  points: number;
  items: ItemDto[];
  /** Points paid instead of stickers when the pool was empty. */
  fallbackPoints: number;
  streakPack: { threshold: number } | null;
}

export interface ApproveResultDto {
  completionId: string;
  drop: DropResultDto;
}

export interface StreakDto {
  current: number;
  longest: number;
  /** Next pack threshold and how many days are left. */
  nextPack: { threshold: number; daysLeft: number; rarity: 'rare' | 'legendary' };
}

export interface PointsDto {
  balance: number;
  earnedTotal: number;
  streak: StreakDto;
  ledger: LedgerEntryDto[];
}

export interface LedgerEntryDto {
  id: string;
  amount: number;
  reason: string;
  label: string;
  createdAt: number;
}

export interface StatsDto {
  memberId: string;
  balance: number;
  earnedTotal: number;
  spentTotal: number;
  streak: StreakDto;
  /** Share of due tasks reported on time over the last 30 days (0-1), null if none. */
  onTimeRate30: number | null;
  approvedCount30: number;
  stickersOwned: number;
  stickersTotal: number;
  history: HistoryEntryDto[];
}

export interface HistoryEntryDto {
  date: LocalDate;
  title: string;
  icon: string;
  status: 'approved' | 'rejected' | 'reported' | 'missed' | 'closed';
  points: number;
  late: boolean;
  at: number | null;
}

export interface WeekCellDto {
  date: LocalDate;
  done: number;
  waiting: number;
  overdue: number;
  todo: number;
  upcoming: number;
}

export interface WeekDto {
  start: LocalDate;
  days: LocalDate[];
  rows: { memberId: string; cells: WeekCellDto[] }[];
}

export interface RewardDto {
  id: string;
  name: string;
  icon: string;
  cost: number;
  active: boolean;
}

export interface RedemptionDto {
  id: string;
  rewardId: string;
  rewardName: string;
  rewardIcon: string;
  memberId: string;
  memberName: string;
  cost: number;
  status: 'requested' | 'delivered' | 'cancelled';
  createdAt: number;
  resolvedAt: number | null;
}

export interface ShopDto {
  balance: number;
  rewards: RewardDto[];
  items: ItemDto[];
  pending: RedemptionDto[];
}

export interface AlbumDto {
  name: string;
  owned: number;
  total: number;
  items: (ItemDto & { owned: boolean; isNew: boolean })[];
}

export interface CollectionDto {
  albums: AlbumDto[];
  avatars: (ItemDto & { owned: boolean })[];
  frames: (ItemDto & { owned: boolean })[];
}

export interface PackDto {
  id: string;
  name: string;
  source: string;
  license: string;
  attribution: string | null;
  builtIn: boolean;
  active: boolean;
  itemCount: number;
  albums: string[];
}

export interface LicenseDto {
  pack: string;
  source: string;
  license: string;
  attribution: string | null;
}

export interface AppReleaseDto {
  versionCode: number;
  versionName: string;
  url: string;
  notes: string | null;
}
