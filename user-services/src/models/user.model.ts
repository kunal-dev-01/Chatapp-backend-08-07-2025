import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// User Interface
export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  username: string;
  email: string;
  password: string;
  fullName: string;
  avatar?: string | undefined;
  banner?: string; // CloudFront URL
  bio?: string;
  
  // Account Status
  isEmailVerified: boolean;
  isActive: boolean;
  isOnline: boolean;
  lastSeen: Date;
  
  // Security
  passwordChangedAt: Date;
  passwordResetToken?: string | undefined;
  passwordResetExpires?: Date | undefined;
  emailVerificationToken?: string | undefined;
  emailVerificationExpires?: Date | undefined;
  
  // Follow System
  followers: mongoose.Types.ObjectId[];
  following: mongoose.Types.ObjectId[];
  followersCount: number;
  followingCount: number;
  
  // Privacy Settings
  privacy: {
    isPrivate: boolean;
    showLastSeen: 'everyone' | 'followers' | 'none';
    showOnlineStatus: 'everyone' | 'followers' | 'none';
    allowMessagesFrom: 'everyone' | 'followers' | 'none';
  };
  
  // Profile Customization
  theme: 'light' | 'dark' | 'auto';
  language: string;
  timezone: string;
  
  // Follow Requests (for private accounts)
  followRequests: {
    sent: mongoose.Types.ObjectId[];
    received: mongoose.Types.ObjectId[];
  };
  
  // Blocked Users
  blockedUsers: mongoose.Types.ObjectId[];
  blockedBy: mongoose.Types.ObjectId[];
  
  // Account Analytics
  accountCreatedAt: Date;
  lastPasswordChange: Date;
  totalMessages: number;
  totalChats: number;
  
  // Device Information
  devices: {
    deviceId: string;
    deviceType: 'web' | 'mobile' | 'desktop';
    deviceName: string;
    lastLogin: Date;
    isActive: boolean;
    pushToken?: string;
  }[];
  
  // Notification Settings
  notifications: {
    messages: boolean;
    followRequests: boolean;
    newFollowers: boolean;
    mentions: boolean;
    emailNotifications: boolean;
    pushNotifications: boolean;
  };
  
  // Methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  createPasswordResetToken(): string;
  createEmailVerificationToken(): string;
  changedPasswordAfter(JWTTimestamp: number): boolean;
}

// User Schema
const userSchema = new Schema<IUser>({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    lowercase: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [30, 'Username cannot exceed 30 characters'],
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores']
  },
  
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
      'Please provide a valid email'
    ]
  },
  
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false // Don't include password in queries by default
  },
  
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    maxlength: [50, 'Full name cannot exceed 50 characters']
  },
  
  avatar: {
    type: String,
    default: null
  },
  
  bio: {
    type: String,
    maxlength: [150, 'Bio cannot exceed 150 characters'],
    trim: true
  },
  
  // Account Status
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  isOnline: {
    type: Boolean,
    default: false
  },
  
  lastSeen: {
    type: Date,
    default: Date.now
  },
  
  // Security Fields
  passwordChangedAt: {
    type: Date,
    default: Date.now
  },
  
  passwordResetToken: String,
  passwordResetExpires: Date,
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  
  // Follow System
  followers: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  following: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  followersCount: {
    type: Number,
    default: 0
  },
  
  followingCount: {
    type: Number,
    default: 0
  },
  banner:{
    type: String
  },
  
  // Privacy Settings
  privacy: {
    isPrivate: {
      type: Boolean,
      default: false
    },
    showLastSeen: {
      type: String,
      enum: ['everyone', 'followers', 'none'],
      default: 'everyone'
    },
    showOnlineStatus: {
      type: String,
      enum: ['everyone', 'followers', 'none'],
      default: 'everyone'
    },
    allowMessagesFrom: {
      type: String,
      enum: ['everyone', 'followers', 'none'],
      default: 'everyone'
    }
  },
  
  // Customization
  theme: {
    type: String,
    enum: ['light', 'dark', 'auto'],
    default: 'auto'
  },
  
  language: {
    type: String,
    default: 'en'
  },
  
  timezone: {
    type: String,
    default: 'UTC'
  },
  
  // Follow Requests
  followRequests: {
    sent: [{
      type: Schema.Types.ObjectId,
      ref: 'User'
    }],
    received: [{
      type: Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  
  // Blocked Users
  blockedUsers: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  blockedBy: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // Analytics
  accountCreatedAt: {
    type: Date,
    default: Date.now
  },
  
  lastPasswordChange: {
    type: Date,
    default: Date.now
  },
  
  totalMessages: {
    type: Number,
    default: 0
  },
  
  totalChats: {
    type: Number,
    default: 0
  },
  
  // Device Management
  devices: [{
    deviceId: {
      type: String,
      required: true
    },
    deviceType: {
      type: String,
      enum: ['web', 'mobile', 'desktop'],
      required: true
    },
    deviceName: {
      type: String,
      required: true
    },
    lastLogin: {
      type: Date,
      default: Date.now
    },
    isActive: {
      type: Boolean,
      default: true
    },
    pushToken: String
  }],
  
  // Notification Settings
  notifications: {
    messages: {
      type: Boolean,
      default: true
    },
    followRequests: {
      type: Boolean,
      default: true
    },
    newFollowers: {
      type: Boolean,
      default: true
    },
    mentions: {
      type: Boolean,
      default: true
    },
    emailNotifications: {
      type: Boolean,
      default: true
    },
    pushNotifications: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance - REMOVED duplicate username and email indexes
// since they're already created by unique: true in the schema fields
userSchema.index({ isOnline: 1 });
userSchema.index({ lastSeen: 1 });
userSchema.index({ followers: 1 });
userSchema.index({ following: 1 });
userSchema.index({ 'devices.deviceId': 1 });

// Virtual for avatar URL
userSchema.virtual('avatarUrl').get(function() {
  return this.avatar || null;
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  // Only run if password was modified
  if (!this.isModified('password')) return next();
  
  // Hash password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);
  
  // Set passwordChangedAt
  if (!this.isNew) {
    this.passwordChangedAt = new Date(Date.now() - 1000);
  }
  
  next();
});

// Instance method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Instance method to create password reset token
userSchema.methods.createPasswordResetToken = function(): string {
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
    
  this.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  
  return resetToken;
};

// Instance method to create email verification token
userSchema.methods.createEmailVerificationToken = function(): string {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  
  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');
    
  this.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  
  return verificationToken;
};

// Instance method to check if password changed after JWT was issued
userSchema.methods.changedPasswordAfter = function(JWTTimestamp: number): boolean {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      (this.passwordChangedAt.getTime() / 1000).toString(),
      10
    );
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Create and export model
const User = mongoose.model<IUser>('User', userSchema);
export default User;