import jwt from "jsonwebtoken";
import { env } from "../lib/env";
import type { StaffRole } from "@contracts/roles";

export interface StaffTokenPayload {
  sub: number;
  username: string;
  staffCode: string;
  name: string;
  role: StaffRole;
}

export function signStaffToken(payload: StaffTokenPayload): string {
  return jwt.sign(payload, env.appSecret, { expiresIn: "7d" });
}

export function verifyStaffToken(token: string): StaffTokenPayload {
  return jwt.verify(token, env.appSecret) as unknown as StaffTokenPayload;
}
