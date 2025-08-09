import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IConversation extends Document {
  _id: Types.ObjectId;
  participants: Types.ObjectId[];
  conversationType: 'direct' | 'group';
  groupInfo?: {
    name: string;
    description?: string;
    avatar?: string;
    admin: Types.ObjectId;
    members: {
      userId: Types.ObjectId;
      role: 'admin' | 'member';
      joinedAt: Date;
    }[];
  };
  lastMessage?: Types.ObjectId;
  lastActivity: Date;
  isArchived: boolean;
  mutedBy: Types.ObjectId[];
  pinnedBy: Types.ObjectId[];
  settings: {
    messageRetention: number; // days
    allowMediaSharing: boolean;
    allowFileSharing: boolean;
  };
  metadata: {
    totalMessages: number;
    mediaCount: number;
    fileCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>({
  participants: [{
    type: Schema.Types.ObjectId,
    required: true,
    index: true
  }],
  conversationType: {
    type: String,
    enum: ['direct', 'group'],
    default: 'direct',
    required: true
  },
  groupInfo: {
    name: {
      type: String,
      maxlength: 100
    },
    description: {
      type: String,
      maxlength: 500
    },
    avatar: String,
    admin: {
      type: Schema.Types.ObjectId
    },
    members: [{
      userId: {
        type: Schema.Types.ObjectId,
        required: true
      },
      role: {
        type: String,
        enum: ['admin', 'member'],
        default: 'member'
      },
      joinedAt: {
        type: Date,
        default: Date.now
      }
    }]
  },
  lastMessage: {
    type: Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastActivity: {
    type: Date,
    default: Date.now,
    index: true
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  mutedBy: [{
    type: Schema.Types.ObjectId
  }],
  pinnedBy: [{
    type: Schema.Types.ObjectId
  }],
  settings: {
    messageRetention: {
      type: Number,
      default: 30 // 30 days
    },
    allowMediaSharing: {
      type: Boolean,
      default: true
    },
    allowFileSharing: {
      type: Boolean,
      default: true
    }
  },
  metadata: {
    totalMessages: {
      type: Number,
      default: 0
    },
    mediaCount: {
      type: Number,
      default: 0
    },
    fileCount: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true,
  collection: 'conversations'
});

// Indexes for better performance
conversationSchema.index({ participants: 1, lastActivity: -1 });
conversationSchema.index({ conversationType: 1 });
conversationSchema.index({ 'groupInfo.admin': 1 });

export const ConversationModel = mongoose.model<IConversation>('Conversation', conversationSchema);