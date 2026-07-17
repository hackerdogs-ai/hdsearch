// RBAC inheritance from hackerdogs-core. The core JWT carries the user's role names
// (e.g. "hd_super", "tenant_admin", "data_analyst"); hd-search maps those to its own
// capability set. Admin roles get the platform-admin scope + unlimited quota; everyone
// else is a standard user on their plan. See docs/AUTH_PLAN_INTEGRATION.md.
import type { Scope } from './apikeys.js';

export type HdRole = 'admin' | 'user';

// core role names (case-insensitive) that grant hd-search admin. Extend as core adds roles.
const ADMIN_ROLE_NAMES = new Set(['hd_super', 'super_admin', 'superadmin', 'tenant_admin', 'admin', 'owner']);

// standard signed-in user: read search/crawl/vector + manage their OWN api keys
const USER_SCOPES: Scope[] = ['search:read', 'crawl:read', 'vector:read', 'admin:keys'];
// platform admin: everything above + the platform-admin scope (gates admin-only endpoints)
const ADMIN_SCOPES: Scope[] = [...USER_SCOPES, 'admin:platform'];

export interface ResolvedRole {
  role: HdRole;
  scopes: Scope[];
  isAdmin: boolean;
}

/** Map the core JWT's role names to an hd-search role + scope set. */
export function rolesToHd(roles?: string[] | null): ResolvedRole {
  const isAdmin = (roles || []).some((r) => ADMIN_ROLE_NAMES.has(String(r).toLowerCase()));
  return isAdmin ? { role: 'admin', scopes: ADMIN_SCOPES, isAdmin: true } : { role: 'user', scopes: USER_SCOPES, isAdmin: false };
}
