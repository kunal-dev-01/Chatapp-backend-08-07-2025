// services/chat-service/src/websocket/websocketManager.ts
import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { RedisService } from '../config/redis.js';
import { MessageModel } from '../models/message.model.js';
import { Types } from 'mongoose';

export interface WebSocketClient extends WebSocket {
  userId?: string;
  isAuthenticated?: boolean;
  conversationIds?: Set<string>;
}

export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp?: number;
  messageId?: string;
}

export interface ChatMessage {
  conversationId: string;
  content?: string;
  messageType: 'text' | 'image' | 'video' | 'document' | 'audio';
  mediaFiles?: any[];
  replyTo?: string;
  messageId?: string; // Added messageId property
}

export interface TypingData {
  conversationId: string;
  isTyping: boolean;
}

export interface JoinConversationData {
  conversationId: string;
}

export interface MessageReactionData {
  messageId: string;
  emoji: string;
  action: 'add' | 'remove';
}

export interface MessageReadData {
  messageId: string;
  conversationId: string;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private clients: Map<string, WebSocketClient> = new Map();
  private conversationClients: Map<string, Set<string>> = new Map();

  constructor(wss: WebSocketServer) {
    this.wss = wss;
    this.initializeWebSocketServer();
  }

  private initializeWebSocketServer(): void {
    this.wss.on('connection', async (ws: WebSocketClient, request) => {
      console.log('🔌 New WebSocket connection attempt');

      try {
        // Authenticate the connection
        const token = this.extractTokenFromRequest(request);
        const user = await this.authenticateToken(token);

        if (!user) {
          ws.close(1008, 'Authentication failed');
          return;
        }

        // Set up client
        ws.userId = user.userId;
        ws.isAuthenticated = true;
        ws.conversationIds = new Set();

        // Store client
        this.clients.set(user.userId, ws);

        // Set user online in Redis
        await RedisService.setUserOnline(user.userId);
        await RedisService.setUserSocketId(user.userId, this.generateSocketId());

        console.log(`✅ User ${user.userId} connected via WebSocket`);

        // Send welcome message
        this.sendToClient(ws, {
          type: 'CONNECTION_SUCCESS',
          data: {
            message: 'Connected successfully',
            userId: user.userId
          }
        });

        // Set up event handlers
        this.setupClientEventHandlers(ws);

        // Handle connection close
        ws.on('close', () => {
          this.handleClientDisconnect(ws);
        });

        ws.on('error', (error) => {
          console.error(`❌ WebSocket error for user ${ws.userId}:`, error);
        });

      } catch (error) {
        console.error('❌ WebSocket connection setup failed:', error);
        ws.close(1011, 'Internal server error');
      }
    });
  }

  private setupClientEventHandlers(ws: WebSocketClient): void {
    ws.on('message', async (rawMessage) => {
      try {
        const message: WebSocketMessage = JSON.parse(rawMessage.toString());
        console.log(`📨 Received message from ${ws.userId}:`, message.type);

        await this.handleClientMessage(ws, message);
      } catch (error) {
        console.error('❌ Error handling client message:', error);
        this.sendErrorToClient(ws, 'Invalid message format');
      }
    });
  }

  private async handleClientMessage(ws: WebSocketClient, message: WebSocketMessage): Promise<void> {
    if (!ws.isAuthenticated || !ws.userId) {
      this.sendErrorToClient(ws, 'Not authenticated');
      return;
    }

    switch (message.type) {
      case 'SEND_MESSAGE':
        await this.handleSendMessage(ws, message.data as ChatMessage);
        break;

      case 'JOIN_CONVERSATION':
        await this.handleJoinConversation(ws, message.data as JoinConversationData);
        break;

      case 'LEAVE_CONVERSATION':
        await this.handleLeaveConversation(ws, message.data as JoinConversationData);
        break;

      case 'TYPING_START':
        await this.handleTypingStart(ws, message.data as TypingData);
        break;

      case 'TYPING_STOP':
        await this.handleTypingStop(ws, message.data as TypingData);
        break;

      case 'MESSAGE_REACTION':
        await this.handleMessageReaction(ws, message.data as MessageReactionData);
        break;

      case 'MESSAGE_READ':
        await this.handleMessageRead(ws, message.data as MessageReadData);
        break;

      case 'GET_ONLINE_USERS':
        await this.handleGetOnlineUsers(ws, message.data);
        break;

      case 'PING':
        this.sendToClient(ws, { type: 'PONG', data: { timestamp: Date.now() } });
        break;

      default:
        this.sendErrorToClient(ws, `Unknown message type: ${message.type}`);
    }
  }

  private async handleSendMessage(ws: WebSocketClient, data: ChatMessage): Promise<void> {
    try {
      // Create message in database
      const newMessage = new MessageModel({
        conversationId: new Types.ObjectId(data.conversationId),
        senderId: new Types.ObjectId(ws.userId!),
        messageType: data.messageType,
        content: data.content,
        mediaFiles: data.mediaFiles || [],
        replyTo: data.replyTo ? new Types.ObjectId(data.replyTo) : undefined,
        status: {
          sent: new Date(),
          delivered: [],
          read: []
        }
      });

      const savedMessage = await newMessage.save();
      await savedMessage.populate('senderId', 'name avatar');

      // Cache message in Redis
      await RedisService.cacheMessage(savedMessage._id.toString(), savedMessage.toObject());

      // Broadcast to conversation participants
      await this.broadcastToConversation(data.conversationId, {
        type: 'NEW_MESSAGE',
        data: savedMessage,
        timestamp: Date.now()
      }, ws.userId);

      // Send confirmation to sender
      this.sendToClient(ws, {
        type: 'MESSAGE_SENT',
        data: {
          tempId: data.messageId,
          message: savedMessage
        }
      });

      console.log(`📤 Message sent in conversation ${data.conversationId}`);

    } catch (error) {
      console.error('❌ Error sending message:', error);
      this.sendErrorToClient(ws, 'Failed to send message');
    }
  }

  private async handleJoinConversation(ws: WebSocketClient, data: JoinConversationData): Promise<void> {
    try {
      const { conversationId } = data;

      // Add user to conversation in memory
      ws.conversationIds?.add(conversationId);

      // Add to Redis
      await RedisService.addUserToConversation(ws.userId!, conversationId);

      // Track conversation clients
      if (!this.conversationClients.has(conversationId)) {
        this.conversationClients.set(conversationId, new Set());
      }
      this.conversationClients.get(conversationId)!.add(ws.userId!);

      // Notify others in conversation
      await this.broadcastToConversation(conversationId, {
        type: 'USER_JOINED',
        data: {
          userId: ws.userId,
          conversationId
        }
      }, ws.userId);

      this.sendToClient(ws, {
        type: 'CONVERSATION_JOINED',
        data: { conversationId }
      });

      console.log(`👥 User ${ws.userId} joined conversation ${conversationId}`);

    } catch (error) {
      console.error('❌ Error joining conversation:', error);
      this.sendErrorToClient(ws, 'Failed to join conversation');
    }
  }

  private async handleLeaveConversation(ws: WebSocketClient, data: JoinConversationData): Promise<void> {
    try {
      const { conversationId } = data;

      // Remove from memory
      ws.conversationIds?.delete(conversationId);

      // Remove from Redis
      await RedisService.removeUserFromConversation(ws.userId!, conversationId);

      // Remove from conversation clients
      this.conversationClients.get(conversationId)?.delete(ws.userId!);

      // Stop typing if was typing
      await RedisService.setTypingStatus(conversationId, ws.userId!, false);

      // Notify others
      await this.broadcastToConversation(conversationId, {
        type: 'USER_LEFT',
        data: {
          userId: ws.userId,
          conversationId
        }
      }, ws.userId);

      this.sendToClient(ws, {
        type: 'CONVERSATION_LEFT',
        data: { conversationId }
      });

      console.log(`👋 User ${ws.userId} left conversation ${conversationId}`);

    } catch (error) {
      console.error('❌ Error leaving conversation:', error);
      this.sendErrorToClient(ws, 'Failed to leave conversation');
    }
  }

  private async handleTypingStart(ws: WebSocketClient, data: TypingData): Promise<void> {
    try {
      await RedisService.setTypingStatus(data.conversationId, ws.userId!, true);

      await this.broadcastToConversation(data.conversationId, {
        type: 'USER_TYPING',
        data: {
          userId: ws.userId,
          conversationId: data.conversationId,
          isTyping: true
        }
      }, ws.userId);

    } catch (error) {
      console.error('❌ Error handling typing start:', error);
    }
  }

  private async handleTypingStop(ws: WebSocketClient, data: TypingData): Promise<void> {
    try {
      await RedisService.setTypingStatus(data.conversationId, ws.userId!, false);

      await this.broadcastToConversation(data.conversationId, {
        type: 'USER_TYPING',
        data: {
          userId: ws.userId,
          conversationId: data.conversationId,
          isTyping: false
        }
      }, ws.userId);

    } catch (error) {
      console.error('❌ Error handling typing stop:', error);
    }
  }

  private async handleMessageReaction(ws: WebSocketClient, data: MessageReactionData): Promise<void> {
    try {
      const message = await MessageModel.findById(data.messageId);
      if (!message) {
        this.sendErrorToClient(ws, 'Message not found');
        return;
      }

      const userId = new Types.ObjectId(ws.userId!);
      let reactionIndex = message.reactions.findIndex((r: { emoji: string; }) => r.emoji === data.emoji);

      if (data.action === 'add') {
        if (reactionIndex === -1) {
          message.reactions.push({
            emoji: data.emoji,
            users: [userId],
            count: 1
          });
        } else {
          const reaction = message.reactions[reactionIndex] as { emoji: string; users: Types.ObjectId[]; count: number; };
          if (!reaction.users.includes(userId)) {
            reaction.users.push(userId);
            reaction.count++;
          }
        }
      } else {
        if (reactionIndex !== -1) {
          const reaction = message.reactions[reactionIndex] as { emoji: string; users: Types.ObjectId[]; count: number; };
          const userIndex = reaction?.users.indexOf(userId);
          if (userIndex !== -1) {
            reaction.users.splice(userIndex as number, 1);
            reaction.count--;
            if (reaction.count === 0) {
              message.reactions.splice(reactionIndex, 1);
            }
          }
        }
      }

      await message.save();

      // Broadcast reaction update
      await this.broadcastToConversation(message.conversationId.toString(), {
        type: 'MESSAGE_REACTION_UPDATED',
        data: {
          messageId: data.messageId,
          reactions: message.reactions
        }
      });

    } catch (error) {
      console.error('❌ Error handling message reaction:', error);
      this.sendErrorToClient(ws, 'Failed to update reaction');
    }
  }

  private async handleMessageRead(ws: WebSocketClient, data: MessageReadData): Promise<void> {
    try {
      const message = await MessageModel.findById(data.messageId);
      if (!message) return;

      const readTime = new Date();
      if (!message.status.read.includes(readTime)) {
        message.status.read.push(readTime);
        await message.save();
      }

      // Notify sender that message was read
      await this.broadcastToConversation(data.conversationId, {
        type: 'MESSAGE_READ',
        data: {
          messageId: data.messageId,
          readBy: ws.userId,
          readAt: readTime
        }
      }, ws.userId);

    } catch (error) {
      console.error('❌ Error handling message read:', error);
    }
  }

  private async handleGetOnlineUsers(ws: WebSocketClient, data: { userIds: string[] }): Promise<void> {
    try {
      const statuses = await RedisService.getMultipleUserStatuses(data.userIds);
      
      this.sendToClient(ws, {
        type: 'ONLINE_USERS',
        data: { userStatuses: statuses }
      });

    } catch (error) {
      console.error('❌ Error getting online users:', error);
      this.sendErrorToClient(ws, 'Failed to get online users');
    }
  }

  private async broadcastToConversation(conversationId: string, message: WebSocketMessage, excludeUserId?: string): Promise<void> {
    const participantIds = this.conversationClients.get(conversationId);
    if (!participantIds) return;

    const broadcastPromises = Array.from(participantIds)
      .filter(userId => userId !== excludeUserId)
      .map(userId => {
        const client = this.clients.get(userId);
        if (client && client.readyState === WebSocket.OPEN) {
          return this.sendToClient(client, message);
        }
      });

    await Promise.all(broadcastPromises);
  }

  private sendToClient(ws: WebSocketClient, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        ...message,
        timestamp: message.timestamp || Date.now()
      }));
    }
  }

  private sendErrorToClient(ws: WebSocketClient, error: string): void {
    this.sendToClient(ws, {
      type: 'ERROR',
      data: { message: error }
    });
  }

  private async handleClientDisconnect(ws: WebSocketClient): Promise<void> {
    if (!ws.userId) return;

    console.log(`🔌 User ${ws.userId} disconnected`);

    try {
      // Set user offline
      await RedisService.setUserOffline(ws.userId);
      await RedisService.removeUserSocketId(ws.userId);

      // Remove from all conversations
      if (ws.conversationIds) {
        for (const conversationId of ws.conversationIds) {
          await RedisService.removeUserFromConversation(ws.userId, conversationId);
          await RedisService.setTypingStatus(conversationId, ws.userId, false);
          
          // Remove from conversation clients
          this.conversationClients.get(conversationId)?.delete(ws.userId);
          
          // Notify others in conversation
          await this.broadcastToConversation(conversationId, {
            type: 'USER_OFFLINE',
            data: { userId: ws.userId }
          });
        }
      }

      // Remove from clients map
      this.clients.delete(ws.userId);

    } catch (error) {
      console.error('❌ Error handling client disconnect:', error);
    }
  }

  private extractTokenFromRequest(request: any): string | null {
    // Try to get token from cookie
    const cookies = request.headers.cookie;
    if (cookies) {
      const tokenMatch = cookies.match(/token=([^;]+)/);
      if (tokenMatch) {
        return tokenMatch[1];
      }
    }

    // Try to get token from Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Try to get token from query parameter
    const url = new URL(request.url, `http://${request.headers.host}`);
    return url.searchParams.get('token');
  }

  private async authenticateToken(token: string | null): Promise<{ userId: string } | null> {
    if (!token) return null;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      return { userId: decoded.userId || decoded.id };
    } catch (error) {
      console.error('❌ Token verification failed:', error);
      return null;
    }
  }

  private generateSocketId(): string {
    return `socket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Public methods for external use
  public getConnectedUsersCount(): number {
    return this.clients.size;
  }

  public getConversationParticipants(conversationId: string): string[] {
    return Array.from(this.conversationClients.get(conversationId) || []);
  }

  public async sendMessageToUser(userId: string, message: WebSocketMessage): Promise<boolean> {
    const client = this.clients.get(userId);
    if (client && client.readyState === WebSocket.OPEN) {
      this.sendToClient(client, message);
      return true;
    }
    return false;
  }

  public async broadcastToAllUsers(message: WebSocketMessage, excludeUserIds: string[] = []): Promise<void> {
    const broadcastPromises = Array.from(this.clients.entries())
      .filter(([userId]) => !excludeUserIds.includes(userId))
      .map(([_, client]) => {
        if (client.readyState === WebSocket.OPEN) {
          return this.sendToClient(client, message);
        }
      });

    await Promise.all(broadcastPromises);
  }
}