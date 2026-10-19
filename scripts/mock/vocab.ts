// Word lists for the mock generator.

export const DOMAINS = [
  'orders', 'payments', 'inventory', 'shipping', 'users', 'catalog', 'pricing', 'search', 'reviews', 'notifications',
  'analytics', 'fraud', 'loyalty', 'returns', 'billing', 'support', 'auth', 'media', 'recommendations', 'cart',
  'checkout', 'tax', 'warehouse', 'carriers', 'promotions',
] as const;

export const SUFFIXES = ['-svc', '-worker', '-api', '-sync', '-reporting'] as const;

export const LANGS = ['typescript', 'python', 'go', 'java', 'kotlin'] as const;

export const EVENTS = ['created', 'updated', 'deleted', 'completed', 'failed', 'expired', 'approved', 'cancelled'] as const;

export const NOUNS: Record<string, string[]> = {
  orders: ['order', 'line', 'quote'], payments: ['payment', 'refund', 'card'], inventory: ['stock', 'reservation', 'sku'],
  shipping: ['shipment', 'label', 'parcel'], users: ['user', 'profile', 'address'], catalog: ['product', 'category', 'variant'],
  pricing: ['price', 'rule', 'currency'], search: ['query', 'index', 'synonym'], reviews: ['review', 'rating', 'report'],
  notifications: ['message', 'template', 'subscription'], analytics: ['event', 'report', 'metric'], fraud: ['check', 'score', 'case'],
  loyalty: ['member', 'point', 'tier'], returns: ['return', 'inspection', 'credit'], billing: ['invoice', 'statement', 'plan'],
  support: ['ticket', 'agent', 'macro'], auth: ['session', 'token', 'client'], media: ['asset', 'upload', 'rendition'],
  recommendations: ['model', 'slate', 'signal'], cart: ['cart', 'item', 'coupon'], checkout: ['checkout', 'step', 'session'],
  tax: ['rate', 'exemption', 'filing'], warehouse: ['bin', 'pick', 'wave'], carriers: ['carrier', 'rate', 'pickup'],
  promotions: ['promotion', 'voucher', 'campaign'],
};
