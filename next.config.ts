import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle used by the portable .exe build.
  output: "standalone",
  experimental: {
    // Used by `next upgrade` and the security reminders on dev/build.
    agentUpgrade: "security",
  },
};

export default nextConfig;
