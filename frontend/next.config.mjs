/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL || "http://localhost:4000";
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  // El navegador solo habla con el origen del frontend: las cookies de sesión quedan same-origin.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};
