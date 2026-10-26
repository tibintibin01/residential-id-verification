import { getStore } from '@netlify/blobs';
import { handlers } from '../../lib/registry.mjs';

export default (request, context) => handlers({
  getStore: () => getStore({ name: 'residential-id-verification-v1', consistency: 'strong', region: process.env.REGISTRY_REGION || 'ap-southeast-1' }),
  enabled: () => process.env.REGISTRY_ENABLED === 'true' && context?.deploy?.context === 'production',
  secret: () => process.env.REGISTRY_PUBLISH_KEY,
}).publish(request);
export const config = { path: '/api/publish', rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
