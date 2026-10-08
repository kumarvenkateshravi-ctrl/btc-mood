import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The development app is opened through both localhost and 127.0.0.1.
  // Permit the alternate local origin so client-only chart chunks can load.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
