export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** HMAC key for signed file URLs. */
  FILE_SIGNING_KEY: string;
  /** Firebase service account JSON (one line). Push is disabled when unset. */
  FCM_SERVICE_ACCOUNT?: string;
}

export interface AuthInfo {
  memberId: string;
  familyId: string;
  role: 'parent' | 'child';
  sessionId: string;
}

export interface AppBindings {
  Bindings: Env;
  Variables: { auth: AuthInfo };
}
