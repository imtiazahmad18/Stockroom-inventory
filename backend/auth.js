// auth.js
// Password hashing + JWT signing/verification.
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set in the environment (.env)');
}

const SALT_ROUNDS = 10;

/** Hash a plaintext password. */
export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Verify a plaintext password against a stored hash. */
export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/** Sign a JWT for a user row. */
export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/** Verify a JWT and return its payload, or throw. */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
