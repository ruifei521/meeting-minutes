import { Redis } from '@upstash/redis';

// ⚠️ 关键：清理环境变量中的 BOM 字符
function cleanEnv(value: string): string {
  return value.replace(/[\uFEFF\u200B]/g, '');
}

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error('Missing Upstash Redis environment variables');
    }
    _redis = new Redis({
      url: cleanEnv(process.env.UPSTASH_REDIS_REST_URL!),
      token: cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN!),
    });
  }
  return _redis;
}

// Alias for backward compat
export const redis = {
  get: (key: string) => getRedis().get(key),
  set: (key: string, value: string, options?: { ex?: number }) => getRedis().set(key, value, options as any),
};

export interface MeetingData {
  id: string;
  summary: string;
  decisions: string[];
  actionItems: {
    id: string;
    task: string;
    owner: string;
    completed: boolean;
  }[];
  transcript: string;
  createdAt: number;
}