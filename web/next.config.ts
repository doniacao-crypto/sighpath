import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The repository root holds its own package-lock.json for the tooling of the desktop
  // project. Without this, Next infers that root and traces files from the wrong place.
  outputFileTracingRoot: path.join(process.cwd()),
  // The MediaPipe wasm loader and the face landmarker model are served from /public.
  // The camera and the WASM runtime need cross-origin isolation for the threaded wasm
  // build, which Vercel provides through these headers.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
