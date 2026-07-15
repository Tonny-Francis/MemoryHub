import crypto from 'node:crypto';

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { db } from '../Config/Db.Config.js';
import { env } from '../Config/Env.Config.js';
import { logger } from '../Config/Logger.Config.js';

const BCRYPT_ROUNDS = 12;

export interface TokenPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET!, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET!) as TokenPayload;
}

export async function login(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw new Error('Invalid credentials');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error('Invalid credentials');

  const accessToken = signAccessToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  const refreshToken = crypto.randomBytes(48).toString('hex');

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await db.session.create({ data: { userId: user.id, refreshToken, expiresAt } });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}

export async function refresh(refreshToken: string) {
  const session = await db.session.findUnique({
    where: { refreshToken },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) await db.session.delete({ where: { id: session.id } });
    throw new Error('Invalid or expired refresh token');
  }

  const accessToken = signAccessToken({
    sub: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  });

  return { accessToken };
}

export async function logout(refreshToken: string): Promise<void> {
  await db.session.deleteMany({ where: { refreshToken } });
}

export async function createUser(email: string, password: string, name: string, role: 'READER' | 'WRITER' | 'ADMIN' = 'WRITER') {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  return db.user.create({
    data: { email: email.toLowerCase(), passwordHash, name, role },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
}

export async function seedAdminIfEmpty(): Promise<void> {
  const { INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_NAME } = env;
  if (!INITIAL_ADMIN_EMAIL || !INITIAL_ADMIN_PASSWORD) return;

  const count = await db.user.count();
  if (count > 0) return;

  await createUser(INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_NAME, 'ADMIN');
  logger.info({ email: INITIAL_ADMIN_EMAIL }, 'Initial admin user created');
}
