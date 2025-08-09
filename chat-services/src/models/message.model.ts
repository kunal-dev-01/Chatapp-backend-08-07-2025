import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMediaFile {
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  metadata?: {
    width?: number;
    height?: number;
    duration?: number; // for videos
    format?: string;
  };
  uploadedAt: Date;
}

export interface IMessage extends Document {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  messageType: 'text' | 'image' | 'video' | 'document' | 'audio';
  content?: string | undefined;
  mediaFiles?: IMediaFile[] | undefined;
  replyTo?: Types.ObjectId | undefined;
  forwarded?: {
    originalMessageId: Types.ObjectId;
    forwardedFrom: Types.ObjectId;
    forwardedAt: Date;
} | undefined;
  reactions: {
    emoji: string;
    users: Types.ObjectId[];
    count: number;
  }[];
  status: {
    sent: Date;
    delivered: Date[];
    read: Date[];
  };
  editHistory: {
    content: string;
    editedAt: Date;
  }[];
  isDeleted: boolean;
  deletedFor: Types.ObjectId[];
  metadata: {
    deviceInfo?: string;
    location?: {
      latitude: number;
      longitude: number;
      address?: string;
    };
  };
  createdAt: Date;
  updatedAt: Date;
}

const mediaFileSchema = new Schema<IMediaFile>({
  originalName: {
    type: String,
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  thumbnailUrl: String,
  metadata: {
    width: Number,
    height: Number,
    duration: Number,
    format: String
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

const messageSchema = new Schema<IMessage>({
  conversationId: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  senderId: {
    type: Schema.Types.ObjectId,
    required: true,
    index: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'video', 'document', 'audio'],
    default: 'text',
    required: true
  },
  content: {
    type: String,
    maxlength: 4000,
    validate: {
      validator: function(value: string): boolean {
        const doc = this as unknown as IMessage;
        // Content required for text messages
        if (doc.messageType === 'text') {
          return Boolean(value && value.trim().length > 0);
        }
        return true;
      },
      message: 'Content is required for text messages'
    }
  },
  mediaFiles: [mediaFileSchema],
  replyTo: {
    type: Schema.Types.ObjectId,
    ref: 'Message'
  },
  forwarded: {
    originalMessageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message'
    },
    forwardedFrom: Schema.Types.ObjectId,
    forwardedAt: {
      type: Date,
      default: Date.now
    }
  },
  reactions: [{
    emoji: {
      type: String,
      required: true
    },
    users: [{
      type: Schema.Types.ObjectId
    }],
    count: {
      type: Number,
      default: 0
    }
  }],
  status: {
    sent: {
      type: Date,
      default: Date.now
    },
    delivered: [{
      type: Date
    }],
    read: [{
      type: Date
    }]
  },
  editHistory: [{
    content: String,
    editedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedFor: [{
    type: Schema.Types.ObjectId
  }],
  metadata: {
    deviceInfo: String,
    location: {
      latitude: Number,
      longitude: Number,
      address: String
    }
  }
}, {
  timestamps: true,
  collection: 'messages'
});

// Indexes for better performance
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, createdAt: -1 });
messageSchema.index({ messageType: 1 });
messageSchema.index({ isDeleted: 1 });

// Validation for media files
messageSchema.pre('save', function(next) {
  if (this.messageType !== 'text' && (!this.mediaFiles || this.mediaFiles.length === 0)) {
    next(new Error('Media files are required for non-text messages'));
    return;
  }
  next();
});

export const MessageModel = mongoose.model<IMessage>('Message', messageSchema);