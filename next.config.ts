import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Used by `next upgrade` and the security reminders on dev/build.
    agentUpgrade: "security",
  },
};

export default nextConfig;
