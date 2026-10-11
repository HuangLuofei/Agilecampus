import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 生产 Docker 镜像用 standalone 产物（.next/standalone + server.js），见 Dockerfile
  output: "standalone",
  // dev 模式下放行非 localhost 来源（局域网/热点访问）。仅影响 `next dev`，
  // 生产构建不读。配防火墙收窄到同网段后，这里用 *.*.*.* 免得 IP 一变就失效。
  allowedDevOrigins: ["*.*.*.*"],
};

export default nextConfig;
