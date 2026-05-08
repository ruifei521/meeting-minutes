import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 将 Redis 等服务端依赖打包为 external，减少 serverless function 体积
  serverExternalPackages: ['@upstash/redis', '@upstash/ratelimit'],

  // 启用 React strict mode（开发时额外检查副作用）
  reactStrictMode: true,
};

export default nextConfig;
