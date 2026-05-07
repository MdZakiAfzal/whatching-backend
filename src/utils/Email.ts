import nodemailer from 'nodemailer';
import { config } from '../config';

export default class Email {
  to: string;
  url: string;
  firstName: string;
  from: string;

  constructor(user: any, url: string) {
    this.to = user.email;
    this.url = url;
    this.firstName = user.name.split(' ')[0];
    this.from = `Whatching <${config.emailFrom}>`;
  }

  private newTransport() {
    if (
      !config.emailHost ||
      !config.emailPort ||
      Number.isNaN(config.emailPort) ||
      !config.emailUser ||
      !config.emailPassword ||
      !config.emailFrom
    ) {
      throw new Error('SMTP is not configured.');
    }

    return nodemailer.createTransport({
      host: config.emailHost,
      port: config.emailPort,
      secure: config.emailPort === 465,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: {
        user: config.emailUser,
        pass: config.emailPassword,
      },
    });
  }

  private logEmail(subject: string, text: string) {
    console.log('\n--- AUTH EMAIL LOG MODE ---');
    console.log(`TO: ${this.to}`);
    console.log(`SUBJECT: ${subject}`);
    console.log(`LINK: ${this.url}`);
    console.log(text);
    console.log('---------------------------\n');
  }

  private async send(subject: string, text: string) {
    if (config.emailDeliveryMode === 'log') {
      this.logEmail(subject, text);
      return;
    }

    await this.newTransport().sendMail({
      from: this.from,
      to: this.to,
      subject,
      text,
    });
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
