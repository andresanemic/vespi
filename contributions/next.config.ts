import type { NextConfig } from 'next';

const config: NextConfig = {
  devIndicators: false,
  async redirects() {
    return [
      '/contributions',
      '/contributions/es',
      '/contributions/las-tres-fronteras-yerko-pincheira-58271dc7.pdf',
    ].map(path => ({ source: path, destination: 'https://vespi.xyz' + path, permanent: false }));
  },
};

export default config;
