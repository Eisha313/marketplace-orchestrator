import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : 'unknown';
  return ip;
}

function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1 };
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - record.count };
}

function extractVendorIdFromPath(pathname: string): string | null {
  const vendorMatch = pathname.match(/\/api\/vendors\/([^/]+)/);
  if (vendorMatch) return vendorMatch[1];
  
  const inventoryMatch = pathname.match(/\/api\/inventory\/([^/]+)/);
  if (inventoryMatch && inventoryMatch[1] !== 'alerts') return inventoryMatch[1];
  
  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only apply to API routes
  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Rate limiting
  const rateLimitKey = getRateLimitKey(request);
  const { allowed, remaining } = checkRateLimit(rateLimitKey);

  if (!allowed) {
    return new NextResponse(
      JSON.stringify({ error: 'Too many requests', retryAfter: RATE_LIMIT_WINDOW / 1000 }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': MAX_REQUESTS_PER_WINDOW.toString(),
          'X-RateLimit-Remaining': '0',
          'Retry-After': Math.ceil(RATE_LIMIT_WINDOW / 1000).toString(),
        },
      }
    );
  }

  // Vendor authentication for protected routes
  const protectedPaths = ['/api/vendors/', '/api/inventory/'];
  const isProtectedPath = protectedPaths.some(path => pathname.startsWith(path));

  if (isProtectedPath && request.method !== 'GET') {
    const authHeader = request.headers.get('authorization');
    const apiKey = request.headers.get('x-api-key');

    if (!authHeader && !apiKey) {
      return new NextResponse(
        JSON.stringify({ error: 'Authentication required' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate vendor access to their own resources
    const vendorId = extractVendorIdFromPath(pathname);
    if (vendorId) {
      const vendorApiKey = apiKey || authHeader?.replace('Bearer ', '');
      
      // In production, validate against database
      // For now, we pass the vendor context to the request
      const response = NextResponse.next();
      response.headers.set('x-vendor-id', vendorId);
      response.headers.set('x-vendor-api-key', vendorApiKey || '');
      response.headers.set('X-RateLimit-Limit', MAX_REQUESTS_PER_WINDOW.toString());
      response.headers.set('X-RateLimit-Remaining', remaining.toString());
      return response;
    }
  }

  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', MAX_REQUESTS_PER_WINDOW.toString());
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
