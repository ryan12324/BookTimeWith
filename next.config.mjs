/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cloudflare-ready: this stays a standard Next.js App Router project so `next dev`
  // and `next build` work with no Cloudflare account. To deploy on Cloudflare later,
  // add `@opennextjs/cloudflare` (see README "Deployment") — no source changes needed.
};

export default nextConfig;
