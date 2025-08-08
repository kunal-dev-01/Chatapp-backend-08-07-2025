// src/config/aws.ts
import { S3Client } from '@aws-sdk/client-s3';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';

// AWS Configuration
export const awsConfig = {
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
};

// S3 Configuration
export const s3Config = {
  bucketName: process.env.S3_BUCKET_NAME!,
  region: process.env.AWS_REGION || 'ap-south-1',
  maxFileSize: 5 * 1024 * 1024, // 5MB
  allowedFormats: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'],
  avatarFolder: 'avatars/',
};

// CloudFront Configuration
export const cloudFrontConfig = {
  distributionDomain: process.env.CLOUDFRONT_DOMAIN!,
  distributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID!,
};

// Initialize AWS Clients
export const s3Client = new S3Client(awsConfig);
export const cloudFrontClient = new CloudFrontClient(awsConfig);

// Generate CloudFront URL
export const generateCloudFrontUrl = (key: string): string => {
  return `https://${cloudFrontConfig.distributionDomain}/${key}`;
};

// Validate environment variables
const requiredEnvVars = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_BUCKET_NAME',
  'CLOUDFRONT_DOMAIN',
  'CLOUDFRONT_DISTRIBUTION_ID'
];

export const validateAwsConfig = (): void => {
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required AWS environment variables: ${missingVars.join(', ')}`);
  }
};