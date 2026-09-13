import nodemailer from 'nodemailer';

/**
 * Lazy transporter — created on first use, NOT at import time.
 * This is critical because ES module imports run BEFORE dotenv.config(),
 * so process.env.SMTP_* would all be undefined if created at the top level.
 */
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: parseInt(process.env.SMTP_PORT, 10) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Send a professional OTP verification email branded with RentMate design.
 * @param {string} toEmail - Recipient email address
 * @param {string} otp - The 6-digit OTP code
 */
export const sendVerificationOtpEmail = async (toEmail, otp) => {
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0; padding:0; background-color:#0B0B0F; font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0B0B0F; padding:40px 20px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#151520; border-radius:16px; overflow:hidden; border:1px solid rgba(109,40,217,0.2);">
            <!-- Header -->
            <tr>
              <td style="padding:32px 40px 24px; text-align:center; border-bottom:1px solid rgba(255,255,255,0.06);">
                <div style="font-size:24px; font-weight:700; color:#ffffff; letter-spacing:-0.5px;">
                  <span style="color:#7c3aed;">⌂</span> RentMate
                </div>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:40px 40px 16px; text-align:center;">
                <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#ffffff;">
                  Verify your email
                </h1>
                <p style="margin:0 0 32px; font-size:14px; color:#9ca3af; line-height:1.6;">
                  Enter this code to complete your RentMate registration.
                </p>

                <!-- OTP Box -->
                <div style="background:linear-gradient(135deg, rgba(124,58,237,0.15), rgba(109,40,217,0.08)); border:1px solid rgba(124,58,237,0.3); border-radius:12px; padding:24px; margin-bottom:32px;">
                  <div style="font-size:36px; font-weight:700; letter-spacing:12px; color:#ffffff; font-family:'Courier New',monospace;">
                    ${otp}
                  </div>
                </div>

                <p style="margin:0; font-size:13px; color:#6b7280; line-height:1.5;">
                  This code expires in <strong style="color:#9ca3af;">5 minutes</strong>.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:24px 40px 32px; text-align:center; border-top:1px solid rgba(255,255,255,0.06);">
                <p style="margin:0; font-size:12px; color:#4b5563; line-height:1.5;">
                  If you did not create a RentMate account, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;

  const mailOptions = {
    from: `"RentMate" <${fromAddress}>`,
    to: toEmail,
    subject: 'RentMate — Verify Your Email',
    html: htmlContent,
  };

  await getTransporter().sendMail(mailOptions);
};
