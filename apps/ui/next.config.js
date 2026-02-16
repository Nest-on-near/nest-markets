/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['reown', '@pingpay/onramp-sdk'],
};

module.exports = nextConfig;
