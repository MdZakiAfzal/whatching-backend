/*import nodemailer from 'nodemailer';
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
      authMethod: 'LOGIN',
      debug: true, 
      logger: true
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
}*/

export default class Email {
  to: string;
  url: string;

  constructor(user: any, url: string) {
    this.to = user.email;
    this.url = url;
  }

  // We keep the method names the same so the Controller doesn't break
  async sendVerification() {
    console.log('\n--- 📧 DUMMY EMAIL SERVICE ---');
    console.log(`TO: ${this.to}`);
    console.log('SUBJECT: Verify your Whatching Account');
    console.log(`VERIFICATION LINK: ${this.url}`);
    console.log('-------------------------------\n');
  }

  async sendPasswordReset() {
    console.log('\n--- 📧 DUMMY EMAIL SERVICE ---');
    console.log(`TO: ${this.to}`);
    console.log('SUBJECT: Password Reset Token');
    console.log(`RESET LINK: ${this.url}`);
    console.log('-------------------------------\n');
  }
}