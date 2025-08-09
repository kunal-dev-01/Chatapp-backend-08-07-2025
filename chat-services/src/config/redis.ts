// services/chat-service/src/config/redis.ts
import 'dotenv/config';
import Redis from 'ioredis';
import { IMessage } from '../models/message.model.js';

let redisClient: Redis;

export const connectRedis = async (): Promise<void> => {
  try {
    console.log('🔄 Connecting to Redis...');

    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is required');
    }

    if (!redisUrl.startsWith('rediss://')) {
      throw new Error('REDIS_URL must be in rediss:// format for Upstash');
    }

    const config = {
      enableReadyCheck: false,
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      connectTimeout: 20000,
      commandTimeout: 5000,
      retryDelayOnFailover: 300,
      keepAlive: 30000,
      family: 4,
      tls: {
        rejectUnauthorized: false
      },
      enableOfflineQueue: true
    };

    redisClient = new Redis(redisUrl, config);

    redisClient.on('error', (err) => {
      console.error('❌ Redis error:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('🔄 Redis connecting...');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis ready');
    });

    redisClient.on('reconnecting', (time = 1000) => {
      console.log(`🔄 Redis reconnecting in ${time}ms...`);
    });

    redisClient.on('close', () => {
      console.log('🔌 Redis connection closed');
    });

    // Wait for the connection to be ready before pinging
    await new Promise<void>((resolve, reject) => {
      if (redisClient.status === 'ready') {
        resolve();
        return;
      }

      const onReady = () => {
        redisClient.off('error', onError);
        resolve();
      };

      const onError = (err: Error) => {
        redisClient.off('ready', onReady);
        reject(err);
      };

      redisClient.once('ready', onReady);
      redisClient.once('error', onError);
    });

    await redisClient.ping();
    console.log('✅ Redis connected successfully');

  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    throw error;
  }
};

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call connectRedis() first.');
  }
  return redisClient;
};

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient) {
    try {
      await redisClient.quit();
      console.log('✅ Redis disconnected');
    } catch (error) {
      console.error('❌ Error during Redis disconnect:', error);
      redisClient.disconnect();
    }
  }
};

export class RedisService {
  private static getClient() {
    if (!redisClient) {
      throw new Error('Redis client not initialized. Call connectRedis() first.');
    }
    return redisClient;
  }

  // Fix: userId should be string, not boolean
  static async setUserOnline(userId: string) {
    try {
      const client = this.getClient();
      await client.hset(`user:${userId}:status`, {
        isOnline: '1',
        lastSeen: Date.now().toString()
      });
    } catch (error) {
      console.error('Error setting user online:', error);
    }
  }

  // Fix: userId should be string, not boolean
  static async setUserOffline(userId: string) {
    try {
      const client = this.getClient();
      await client.hset(`user:${userId}:status`, {
        isOnline: '0',
        lastSeen: Date.now().toString()
      });
    } catch (error) {
      console.error('Error setting user offline:', error);
    }
  }

  static async getUserStatus(userId: string) {
    try {
      const client = this.getClient();
      const status = await client.hmget(`user:${userId}:status`, 'isOnline', 'lastSeen');
      return {
        isOnline: status[0] === '1',
        lastSeen: parseInt(status[1] || '0')
      };
    } catch (error) {
      console.error('Error getting user status:', error);
      return { isOnline: false, lastSeen: 0 };
    }
  }

  static async addUserToConversation(userId: string, conversationId: string) {
    try {
      const client = this.getClient();
      await client.sadd(`user:${userId}:conversations`, conversationId);
    } catch (error) {
      console.error('Error adding user to conversation:', error);
    }
  }

  static async removeUserFromConversation(userId: string, conversationId: string) {
    try {
      const client = this.getClient();
      await client.srem(`user:${userId}:conversations`, conversationId);
    } catch (error) {
      console.error('Error removing user from conversation:', error);
    }
  }

  static async getUserConversations(userId: string) {
    try {
      const client = this.getClient();
      return await client.smembers(`user:${userId}:conversations`);
    } catch (error) {
      console.error('Error getting user conversations:', error);
      return [];
    }
  }

  static async setTypingStatus(conversationId: string, userId: string, isTyping: boolean) {
    try {
      const client = this.getClient();
      const key = `typing:${conversationId}`;
      if (isTyping) {
        await client.sadd(key, userId);
        await client.expire(key, 10);
      } else {
        await client.srem(key, userId);
      }
    } catch (error) {
      console.error('Error setting typing status:', error);
    }
  }

  static async getTypingUsers(conversationId: string) {
    try {
      const client = this.getClient();
      return await client.smembers(`typing:${conversationId}`);
    } catch (error) {
      console.error('Error getting typing users:', error);
      return [];
    }
  }

  static async cacheMessage(messageId: string, messageData: IMessage) {
    try {
      const client = this.getClient();
      await client.setex(`message:${messageId}`, 3600, JSON.stringify(messageData));
    } catch (error) {
      console.error('Error caching message:', error);
    }
  }

  static async getCachedMessage(messageId: string) {
    try {
      const client = this.getClient();
      const cached = await client.get(`message:${messageId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting cached message:', error);
      return null;
    }
  }

  static async setUserSocketId(userId: string, socketId: string) {
    try {
      const client = this.getClient();
      await client.setex(`socket:${userId}`, 86400, socketId);
    } catch (error) {
      console.error('Error setting user socket ID:', error);
    }
  }

  static async getUserSocketId(userId: string) {
    try {
      const client = this.getClient();
      return await client.get(`socket:${userId}`);
    } catch (error) {
      console.error('Error getting user socket ID:', error);
      return null;
    }
  }

  static async removeUserSocketId(userId: string) {
    try {
      const client = this.getClient();
      await client.del(`socket:${userId}`);
    } catch (error) {
      console.error('Error removing user socket ID:', error);
    }
  }

  static async getMultipleUserStatuses(userIds: string[]) {
    try {
      const client = this.getClient();
      const pipeline = client.pipeline();
      
      userIds.forEach(userId => {
        pipeline.hmget(`user:${userId}:status`, 'isOnline', 'lastSeen');
      });

      const results = await pipeline.exec();
      const statuses: Record<string, { isOnline: boolean; lastSeen: number }> = {};

      userIds.forEach((userId: string, index: number) => {
        const result = results?.[index];
        if (result && !result[0]) {
          const [isOnline, lastSeen] = result[1] as string[];
          statuses[userId] = {
            isOnline: isOnline === '1',
            lastSeen: parseInt(lastSeen || '0')
          };
        }
      });

      return statuses;
    } catch (error) {
      console.error('Error getting multiple user statuses:', error);
      return {};
    }
  }
}