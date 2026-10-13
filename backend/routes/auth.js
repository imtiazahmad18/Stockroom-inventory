// routes/auth.js
// POST /api/auth/register  -> 201 { token, user }
// POST /api/auth/login     -> 200 { token, user }
import { Router } from 'express';
import { createHmac, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import prisma from '../lib/prisma.js';
import { hashPassword, verifyPassword, signToken } from '../auth.js';
import { isPasswordResetEmailConfigured, sendPasswordResetCode } from '../email.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const RESET_LIFETIME_MS = 10 * 60 * 1000;
const RESET_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

function digest(value) {
  return createHmac('sha256', process.env.JWT_SECRET).update(value).digest('hex');
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function cleanEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function stillValid(record) {
  return record && Date.parse(record.expires_at) > Date.now();
}

function validateBody(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!EMAIL_RE.test(email)) return { error: 'A valid email is required.' };
  if (password.length < MIN_PASSWORD) {
    return { error: `Password must be at least ${MIN_PASSWORD} characters.` };
  }
  return { email, password };
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role };
}

router.post('/register', async (req, res) => {
  try {
    const { email, password, error } = validateBody(req.body);
    if (error) return res.status(400).json({ error });

    const existing = await prisma.users.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered.' });

    const password_hash = await hashPassword(password);
    const user = await prisma.users.create({
      data: { email, password_hash, role: 'user' },
    });

    const token = signToken(user);
    return res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'Registration failed.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, error } = validateBody(req.body);
    if (error) return res.status(401).json({ error: 'Invalid email or password.' });

    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });

    const token = signToken(user);
    return res.status(200).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

// Always use the same response so the endpoint does not reveal registered emails.
router.post('/forgot-password', async (req, res) => {
  const email = cleanEmail(req.body?.email);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!isPasswordResetEmailConfigured()) {
    return res.status(503).json({
      error: 'Email delivery is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM to backend/.env, then restart the backend.',
    });
  }

  try {
    const user = await prisma.users.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      const existing = await prisma.password_reset_otps.findUnique({ where: { email } });
      if (!existing || Date.now() - Date.parse(existing.created_at) >= RESET_COOLDOWN_MS) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const expiresAt = new Date(Date.now() + RESET_LIFETIME_MS).toISOString();
        const createdAt = new Date().toISOString();
        await prisma.password_reset_otps.upsert({
          where: { email },
          create: { email, code_hash: digest(code), expires_at: expiresAt, created_at: createdAt },
          update: { code_hash: digest(code), reset_token_hash: null, expires_at: expiresAt, attempts: 0, created_at: createdAt },
        });
        try {
          await sendPasswordResetCode(email, code);
        } catch (err) {
          await prisma.password_reset_otps.deleteMany({
            where: { email, code_hash: digest(code), created_at: createdAt },
          });
          console.error('Password reset email failed:', err.message);
          return res.status(503).json({ error: 'Could not send the reset code. Check the email service settings and try again.' });
        }
      }
    }
    return res.json({ message: 'If that email is registered, a reset code has been sent.' });
  } catch (err) {
    console.error('forgot password error', err);
    return res.status(500).json({ error: 'Could not start password reset.' });
  }
});

router.post('/verify-reset-code', async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter the email address and 6-digit code.' });
  }

  try {
    const record = await prisma.password_reset_otps.findUnique({ where: { email } });
    if (!stillValid(record) || record.attempts >= MAX_OTP_ATTEMPTS || !record.code_hash) {
      return res.status(400).json({ error: 'The code is invalid or expired. Request a new code.' });
    }
    if (!safeEqual(record.code_hash, digest(code))) {
      const attempts = record.attempts + 1;
      if (attempts >= MAX_OTP_ATTEMPTS) {
        await prisma.password_reset_otps.delete({ where: { email } });
      } else {
        await prisma.password_reset_otps.update({ where: { email }, data: { attempts } });
      }
      return res.status(400).json({ error: 'The code is invalid or expired. Request a new code.' });
    }

    const resetToken = randomBytes(32).toString('hex');
    await prisma.password_reset_otps.update({
      where: { email },
      data: { code_hash: null, reset_token_hash: digest(resetToken) },
    });
    return res.json({ resetToken, message: 'Code verified.' });
  } catch (err) {
    console.error('verify reset code error', err);
    return res.status(500).json({ error: 'Could not verify the reset code.' });
  }
});

router.post('/reset-password', async (req, res) => {
  const resetToken = typeof req.body?.resetToken === 'string' ? req.body.resetToken : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (newPassword.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  }

  try {
    const record = await prisma.password_reset_otps.findFirst({
      where: { reset_token_hash: digest(resetToken) },
    });
    if (!stillValid(record) || !record.reset_token_hash || !safeEqual(record.reset_token_hash, digest(resetToken))) {
      return res.status(400).json({ error: 'The reset session expired. Request a new code.' });
    }

    await prisma.$transaction([
      prisma.users.update({ where: { email: record.email }, data: { password_hash: await hashPassword(newPassword) } }),
      prisma.password_reset_otps.delete({ where: { email: record.email } }),
    ]);
    return res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (err) {
    console.error('reset password error', err);
    return res.status(500).json({ error: 'Could not reset the password.' });
  }
});

export default router;
