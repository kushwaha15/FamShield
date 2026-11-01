import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export interface OtpDelivery {
  sendEmail(address: string, code: string, purpose: string): Promise<void>;
  sendSms(phone: string, code: string, purpose: string): Promise<void>;
}

class DevelopmentOtpDelivery implements OtpDelivery {
  async sendEmail(address: string, code: string, purpose: string): Promise<void> {
    void [address, code, purpose];
  }

  async sendSms(phone: string, code: string, purpose: string): Promise<void> {
    void [phone, code, purpose];
  }
}

class HttpEmailDelivery {
  async sendEmail(address: string, code: string, purpose: string): Promise<void> {
    const response = await fetch(env.EMAIL_HTTP_URL!, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.EMAIL_HTTP_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        to: address,
        subject: 'Your FamShield verification code',
        text: `Your FamShield ${purpose} code is ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes.`,
      }),
    });

    if (!response.ok) {
      throw new ApiError(503, 'OTP_DELIVERY_UNAVAILABLE', 'Verification delivery is unavailable.');
    }
  }
}

class HttpSmsDelivery {
  async sendSms(phone: string, code: string, purpose: string): Promise<void> {
    const response = await fetch(env.SMS_HTTP_URL!, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SMS_HTTP_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        to: phone,
        message: `Your FamShield ${purpose} code is ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes.`,
      }),
    });

    if (!response.ok) {
      throw new ApiError(503, 'OTP_DELIVERY_UNAVAILABLE', 'Verification delivery is unavailable.');
    }
  }
}

class TwilioSmsDelivery {
  async sendSms(phone: string, code: string, purpose: string): Promise<void> {
    const accountSid = env.TWILIO_ACCOUNT_SID!;
    const credentials = Buffer.from(`${accountSid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const body = new URLSearchParams({
      To: phone,
      From: env.TWILIO_FROM_NUMBER!,
      Body: `Your FamShield ${purpose} code is ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes.`,
    });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(5000),
        body,
      },
    );

    if (!response.ok) {
      throw new ApiError(503, 'OTP_DELIVERY_UNAVAILABLE', 'Verification delivery is unavailable.');
    }
  }
}

const developmentDelivery = new DevelopmentOtpDelivery();
const emailDelivery = env.EMAIL_PROVIDER === 'http' ? new HttpEmailDelivery() : developmentDelivery;
const smsDelivery =
  env.SMS_PROVIDER === 'twilio'
    ? new TwilioSmsDelivery()
    : env.SMS_PROVIDER === 'http'
      ? new HttpSmsDelivery()
      : developmentDelivery;

export const otpDelivery: OtpDelivery = {
  async sendEmail(address, code, purpose) {
    try {
      await emailDelivery.sendEmail(address, code, purpose);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'OTP_DELIVERY_UNAVAILABLE', 'Verification delivery is unavailable.');
    }
  },
  async sendSms(phone, code, purpose) {
    try {
      await smsDelivery.sendSms(phone, code, purpose);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'OTP_DELIVERY_UNAVAILABLE', 'Verification delivery is unavailable.');
    }
  },
};
