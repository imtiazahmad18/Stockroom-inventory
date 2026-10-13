import nodemailer from 'nodemailer';

export function isPasswordResetEmailConfigured() {
  const { SMTP_HOST, SMTP_PORT = '587', SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  const port = Number(SMTP_PORT);
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM)
    && Number.isInteger(port) && port >= 1 && port <= 65535;
}

export async function sendPasswordResetCode(email, code) {
  const { SMTP_HOST, SMTP_PORT = '587', SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    const error = new Error('SMTP settings are missing.');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }

  const port = Number(SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error('SMTP_PORT must be a valid port number.');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: 'Your Stockroom password reset code',
    text: `Your Stockroom password reset code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Your Stockroom password reset code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
  });
  transporter.close();
}
