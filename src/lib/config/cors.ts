export interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  credentials: boolean;
  maxAge: number;
}

export const corsConfig: CorsConfig = {
  allowedOrigins: [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    ...(process.env.ALLOWED_ORIGINS?.split(',') || []),
  ].filter(Boolean),
  allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'X-Vendor-Id',
    'X-Request-Id',
  ],
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-Request-Id',
  ],
  credentials: true,
  maxAge: 86400, // 24 hours
};

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  
  // Allow all origins in development
  if (process.env.NODE_ENV === 'development') return true;
  
  return corsConfig.allowedOrigins.includes(origin);
}

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  
  if (isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
    headers['Access-Control-Allow-Methods'] = corsConfig.allowedMethods.join(', ');
    headers['Access-Control-Allow-Headers'] = corsConfig.allowedHeaders.join(', ');
    headers['Access-Control-Expose-Headers'] = corsConfig.exposedHeaders.join(', ');
    headers['Access-Control-Max-Age'] = corsConfig.maxAge.toString();
    
    if (corsConfig.credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
  }
  
  return headers;
}
