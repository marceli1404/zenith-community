/** Community access: the self-hosted edition has no subscription or trial gate. */
import type { Plan } from "@shared/entitlements";

export interface Access {
  plan: Plan;
  source: "community";
}

export async function resolveAccess(_db: D1Database, _userId: string): Promise<Access> {
  return { plan: "community", source: "community" };
}
