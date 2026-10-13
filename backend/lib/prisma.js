// lib/prisma.js
// Single shared PrismaClient instance for the whole backend.
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export default prisma;
