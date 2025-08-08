export interface EmailOptions {
  to: string;
  subject: string;
  templateName: string;
  templateData: TemplateData;
}

export interface EmailTemplate {
  html: string;
  text: string;
}

// Define specific error types that SES can throw
export interface SESError extends Error {
  name: 'MessageRejected' | 'SendingPausedException' | 'MailFromDomainNotVerifiedException' | 'ConfigurationSetDoesNotExistException' | string;
  message: string;
  $fault?: string;
  $metadata?: Record<string, unknown>;
}

// Template data interface for better type safety with index signature
export interface EmailVerificationData {
  fullName: string;
  verificationUrl: string;
  appName: string;
  [key: string]: string | number | boolean; // Index signature
}

export interface PasswordResetData {
  fullName: string;
  resetUrl: string;
  appName: string;
  [key: string]: string | number | boolean; // Index signature
}


export type TemplateData = EmailVerificationData | PasswordResetData | Record<string, string | number | boolean>;