// src/utils/email.ts
import { SESClient, SendEmailCommand, SESServiceException } from "@aws-sdk/client-ses";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { AppError } from "./AppError";

import {
    EmailOptions,
    EmailTemplate,
    TemplateData,
    PasswordResetData,
    EmailVerificationData,
    SESError
} from "../types/email.type";


// ES modules compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SES Configuration
const sesClient = new SESClient({
  region: process.env.SES_REGION || "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export class EmailService {
  private static readonly FROM_EMAIL: string =
    process.env.FROM_EMAIL || "noreply@chatapp.com";
  private static readonly FROM_NAME: string = process.env.FROM_NAME || "Sova";

  /**
   * Load email template from file
   */
  private static async loadTemplate(templateName: string): Promise<string> {
    try {
      const templatePath: string = path.join(
        __dirname,
        "..",
        "templates",
        `${templateName}.html`
      );
      console.log("Template path:", templatePath);
      console.log("Current __dirname:", __dirname);

      // Check if file exists
      const fileExists: boolean = await fs
        .access(templatePath)
        .then((): boolean => true)
        .catch((): boolean => false);
      console.log("File exists:", fileExists);

      return await fs.readFile(templatePath, "utf-8");
    } catch (error: unknown) {
      console.error("Template loading error:", error);
      
      // Type guard for Error objects
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new AppError(`Email template '${templateName}' not found: ${errorMessage}`, 500);
    }
  }

  /**
   * Replace template variables with actual data
   */
  private static replaceTemplateVariables(
    template: string,
    data: TemplateData
  ): string {
    let processedTemplate: string = template;

    Object.keys(data).forEach((key: string): void => {
      const placeholder: string = `{{${key}}}`;
      const value: string = String(data[key] || "");
      processedTemplate = processedTemplate.replace(
        new RegExp(placeholder, "g"),
        value
      );
    });

    return processedTemplate;
  }

  /**
   * Generate text version from HTML
   */
  private static htmlToText(html: string): string {
    return html
      .replace(/<[^>]*>/g, "") // Remove HTML tags
      .replace(/\s+/g, " ") // Replace multiple spaces with single space
      .trim();
  }

  /**
   * Process email template
   */
  private static async processTemplate(
    templateName: string,
    data: TemplateData
  ): Promise<EmailTemplate> {
    const htmlTemplate: string = await this.loadTemplate(templateName);
    const html: string = this.replaceTemplateVariables(htmlTemplate, data);
    const text: string = this.htmlToText(html);

    return { html, text };
  }

  /**
   * Send email using AWS SES
   */
  public static async sendEmail(options: EmailOptions): Promise<void> {
    try {
      // Process template
      const { html, text }: EmailTemplate = await this.processTemplate(
        options.templateName,
        options.templateData
      );

      // Prepare SES command
      const command = new SendEmailCommand({
        Source: `${this.FROM_NAME} <${this.FROM_EMAIL}>`,
        Destination: {
          ToAddresses: [options.to],
        },
        Message: {
          Subject: {
            Data: options.subject,
            Charset: "UTF-8",
          },
          Body: {
            Html: {
              Data: html,
              Charset: "UTF-8",
            },
            Text: {
              Data: text,
              Charset: "UTF-8",
            },
          },
        },
        Tags: [
          {
            Name: "Service",
            Value: "ChatApp",
          },
          {
            Name: "Template",
            Value: options.templateName,
          },
        ],
      });

      // Send email
      await sesClient.send(command);
      console.log(`Email sent successfully to ${options.to}`);
      
    } catch (error: unknown) {
      console.error("Email sending failed:", error);

      // Type guard for SES errors
      if (this.isSESError(error)) {
        switch (error.name) {
          case "MessageRejected":
            throw new AppError("Email address is invalid or blocked", 400);
          case "SendingPausedException":
            throw new AppError("Email sending is temporarily paused", 500);
          case "MailFromDomainNotVerifiedException":
            throw new AppError("Email domain not verified", 500);
          case "ConfigurationSetDoesNotExistException":
            throw new AppError("SES configuration set not found", 500);
          default:
            throw new AppError(`SES Error: ${error.message}`, 500);
        }
      }

      // Handle AppError instances
      if (error instanceof AppError) {
        throw error;
      }

      // Handle generic errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new AppError(`Failed to send email: ${errorMessage}`, 500);
    }
  }

  /**
   * Type guard to check if error is SES related
   */
  private static isSESError(error: unknown): error is SESError {
    return (
      error instanceof Error &&
      (error.name === 'MessageRejected' ||
       error.name === 'SendingPausedException' ||
       error.name === 'MailFromDomainNotVerifiedException' ||
       error.name === 'ConfigurationSetDoesNotExistException' ||
       error instanceof SESServiceException)
    );
  }

  /**
   * Validate SES configuration
   */
  public static validateSESConfig(): void {
    const requiredVars: string[] = [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "FROM_EMAIL",
    ];
    const missingVars: string[] = requiredVars.filter(
      (varName: string): boolean => !process.env[varName]
    );

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required SES environment variables: ${missingVars.join(", ")}`
      );
    }

    // Validate email format
    const emailRegex: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.FROM_EMAIL)) {
      throw new Error("FROM_EMAIL environment variable is not a valid email address");
    }
  }

  /**
   * Type-safe email sending for specific templates
   */
  public static async sendVerificationEmail(
    to: string,
    data: EmailVerificationData
  ): Promise<void> {
    await this.sendEmail({
      to,
      subject: `Verify Your Email - ${data.appName}`,
      templateName: 'emailVerification',
      templateData: data
    });
  }

  public static async sendPasswordResetEmail(
    to: string,
    data: PasswordResetData
  ): Promise<void> {
    await this.sendEmail({
      to,
      subject: `Reset Your Password - ${data.appName}`,
      templateName: 'passwordReset',
      templateData: data
    });
  }
}

// Export the main function for backwards compatibility
export const sendEmail = EmailService.sendEmail.bind(EmailService);