import nodemailer from 'nodemailer';
import { config } from '../config';

export default class Email {
  to: string;
  firstName: string;
  url: string;
  from: string;

  constructor(user: any, url: string) {
    this.to = user.email;
    this.firstName = user.name.split(' ')[0];
    this.url = url;
    this.from = `Whatching <${config.emailFrom}>`;
  }

  newTransport() {
    // Titan Mail works best with SSL on port 465
    return nodemailer.createTransport({
      host: config.emailHost,
      port: config.emailPort,
      secure: true, // true for 465, false for other ports
      auth: {
        user: config.emailUser,
        pass: config.emailPassword,
      },
    });
  }

  async send(subject: string, text: string) {
    const mailOptions = {
      from: this.from,
      to: this.to,
      subject,
      text,
    };

    await this.newTransport().sendMail(mailOptions);
  }

  async sendVerification() {
    await this.send(
      'Verify your Whatching Account',
      `Hi ${this.firstName},\n\nWelcome to Whatching! Please verify your account by clicking the link below:\n${this.url}\n\nIf you didn't create an account, please ignore this email.`
    );
  }

  async sendPasswordReset() {
    await this.send(
      'Your password reset token (valid for 10 min)',
      `Hi ${this.firstName},\n\nForgot your password? Click the link below to reset it:\n${this.url}\n\nIf you didn't request this, please ignore this email.`
    );
  }
}