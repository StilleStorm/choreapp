/**
 * Request schemas and response types shared by the API and the app.
 */
import { isLocalDate, isLocalTime, isValidTimeZone } from '@choreapp/core';
import { z } from 'zod';

export * from './types.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const localDate = z.string().refine(isLocalDate, 'invalid_date');
export const localTime = z.string().refine(isLocalTime, 'invalid_time');
export const timeZone = z.string().refine(isValidTimeZone, 'invalid_time_zone');
export const id = z.string().min(1).max(64);
const name = z.string().trim().min(1).max(40);
const email = z.string().trim().toLowerCase().email().max(200);
const password = z.string().min(8).max(200);

export const THEMES = [
  'kawaii',
  'manga',
  'pixel',
  'neon',
  'forest',
  'magical',
  'shoujo',
  'notebook',
  'guild',
  'ink',
  'retro90',
  'space',
  'sport',
  'monsters',
  'ghosts',
  'idols',
  'lanterns',
  'waves',
  'detective',
  'bento',
  'ducks',
  'capybara',
  'axolotl',
  'comic',
  'minimal',
] as const;
export type ThemeId = (typeof THEMES)[number];
/** Adults may also keep the plain neutral style (the app's base tokens); it is their default. */
export const NEUTRAL_THEME = 'neutral';
/**
 * Not offered to adults: dark pages with light cards. Their light inputs, chips,
 * plain buttons and sheet titles sit outside the cards in the adults' forms and
 * get the page's light text colour, so they are unreadable there.
 */
export const ADULT_HIDDEN_THEMES: readonly string[] = ['guild', 'lanterns', 'detective'];
/** Every theme id the API stores; which ones a member may pick depends on the role. */
export const ALL_THEMES = [NEUTRAL_THEME, ...THEMES] as const;

/** Adults: neutral plus the readable themes. Children: any of the 25. */
export function themeAllowed(role: 'parent' | 'child', theme: string): boolean {
  if (role === 'child') return (THEMES as readonly string[]).includes(theme);
  return theme === NEUTRAL_THEME || ((THEMES as readonly string[]).includes(theme) && !ADULT_HIDDEN_THEMES.includes(theme));
}

// ---------------------------------------------------------------------------
// Auth, family, members, invites
// ---------------------------------------------------------------------------

export const registerBody = z.object({
  familyName: name,
  parentName: name,
  email,
  password,
  timezone: timeZone.optional(),
});

export const loginBody = z.object({ email, password: z.string().min(1).max(200) });

export const updateMeBody = z.object({
  name: name.optional(),
  theme: z.enum(ALL_THEMES).optional(),
});

/** An adult changes their own login; both need the current password. */
export const changeEmailBody = z.object({ currentPassword: z.string().min(1).max(200), newEmail: email });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password });
/** An adult deletes their own account (or, as administrator, the whole family). */
export const deleteAccountBody = z.object({ currentPassword: z.string().min(1).max(200) });
/** An adult proves it's them (back from a child's account on their own phone, when the phone has no screen lock). */
export const verifyPasswordBody = z.object({ currentPassword: z.string().min(1).max(200) });
/** The administrator hands the role to another adult of the same family. */
export const transferAdminBody = z.object({ memberId: id, currentPassword: z.string().min(1).max(200) });

/** Forgotten password (adults only): a 6-digit code is e-mailed, then exchanged for a new password. */
export const forgotPasswordBody = z.object({ email });
export const resetPasswordBody = z.object({
  email,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
  newPassword: password,
});

export const appearanceBody = z.object({
  /** An owned avatar item or any theme avatar; null = use the uploaded photo (or initials). */
  avatarItemId: id.nullable(),
  frameItemId: id.nullable(),
});

export const updateFamilyBody = z.object({
  name: name.optional(),
  timezone: timeZone.optional(),
  quietFrom: localTime.optional(),
  quietTo: localTime.optional(),
  reminderTime: localTime.optional(),
  priceCommon: z.number().int().min(1).max(10_000).optional(),
  priceRare: z.number().int().min(1).max(10_000).optional(),
  priceLegendary: z.number().int().min(1).max(10_000).optional(),
});

export const updateMemberBody = z.object({ name: name.optional() });

export const createInviteBody = z.object({
  role: z.enum(['parent', 'child']),
  /** Set to reconnect a child's new phone or reset a parent's password. */
  memberId: id.optional(),
  /** With a child's memberId: another device that keeps the child's other devices logged in. */
  addDevice: z.boolean().optional(),
});

/** An adult adds a child who has no phone (uses the adult's phone). Nickname only. */
export const createChildBody = z.object({ name });

/** Either the QR token or the short code typed by hand. */
export const inviteRef = z
  .object({
    token: z.string().min(16).max(100).optional(),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .refine((v) => !!v.token !== !!v.code, 'token_or_code');

export const redeemInviteBody = z.object({
  token: z.string().min(16).max(100).optional(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional(),
  name: name.optional(),
  email: email.optional(),
  password: password.optional(),
});

export const registerDeviceBody = z.object({
  pushToken: z.string().min(10).max(4096),
  appVersion: z.string().max(40).optional(),
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const recurrenceInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once') }),
  z.object({ kind: z.literal('daily') }),
  z.object({
    kind: z.literal('weekly'),
    interval: z.number().int().min(1).max(12),
    days: z
      .array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]))
      .min(1)
      .max(7),
  }),
  z.object({ kind: z.literal('monthly'), day: z.number().int().min(1).max(31) }),
]);

export const taskInput = z.object({
  title: z.string().trim().min(1).max(80),
  icon: z.string().min(1).max(60),
  description: z.string().trim().max(500).nullable().optional(),
  assignees: z.array(id).min(1).max(20),
  sharedMode: z.enum(['each', 'any']).default('each'),
  startDate: localDate,
  dueTime: localTime.nullable().optional(),
  recurrence: recurrenceInput,
  points: z.union([z.literal(5), z.literal(10), z.literal(20)]).default(10),
});
export type TaskInput = z.infer<typeof taskInput>;

export const reportBody = z.object({
  /** Idempotency key generated on the phone; lets the offline queue retry safely. */
  clientOpId: z.string().min(8).max(64),
  /** When the child tapped "Zrobiłem" (offline queue); clamped server-side. */
  reportedAt: z.number().int().positive().optional(),
});

export const rejectBody = z.object({ comment: z.string().trim().max(300).nullable().optional() });

// ---------------------------------------------------------------------------
// Shop, rewards, packs
// ---------------------------------------------------------------------------

export const rewardInput = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().min(1).max(60),
  cost: z.number().int().min(1).max(100_000),
  active: z.boolean().default(true),
});

export const packInput = z.object({
  name: z.string().trim().min(1).max(60),
  source: z.string().trim().min(1).max(300),
  license: z.string().trim().min(1).max(100),
  attribution: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().default(true),
});

export const packUpdate = packInput.partial();

export const itemUpdate = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  album: z.string().trim().min(1).max(60).optional(),
  rarity: z.enum(['common', 'rare', 'legendary']).optional(),
  kind: z.enum(['sticker', 'avatar', 'frame']).optional(),
  /** null = drop only, 0 = family default for the rarity, >0 = fixed price. */
  price: z.number().int().min(0).max(100_000).nullable().optional(),
  droppable: z.boolean().optional(),
});
