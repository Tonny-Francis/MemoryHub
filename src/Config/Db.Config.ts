import { PrismaClient } from '@prisma/client';
import { logger } from './Logger.Config.js';

export const db = new PrismaClient({
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

db.$on('error', (e) => logger.error(e, 'Prisma error'));
db.$on('warn', (e) => logger.warn(e, 'Prisma warning'));
