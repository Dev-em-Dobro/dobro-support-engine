/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [],
  },
  // Evita o webpack empacotar yoga-layout/wasm do react-pdf — em produção
  // isso vira 500 genérico na hora de gerar o PDF.
  experimental: {
    serverComponentsExternalPackages: ['@react-pdf/renderer', 'yoga-layout'],
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      canvas: false,
      encoding: false,
    };
    return config;
  },
};

module.exports = nextConfig;
