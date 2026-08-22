/**
 * URL validation for SSRF protection.
 *
 * Webhooks allow the server to make HTTP requests to user-specified URLs.
 * Without validation, an attacker could:
 *   - Access cloud metadata endpoints (169.254.169.254)
 *   - Scan internal networks (10.x, 172.16-31.x, 192.168.x)
 *   - Access localhost services
 *   - Probe internal ports
 *
 * This module validates URLs before any outbound request is made.
 */

import { URL } from 'url';
import dns from 'dns/promises';
import net from 'net';

const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * Check if an IP address is in a private/reserved range.
 */
function isPrivateIP(ip: string): boolean {
  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    
    // 10.0.0.0/8 - Private
    if (parts[0] === 10) return true;
    
    // 172.16.0.0/12 - Private
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    
    // 192.168.0.0/16 - Private
    if (parts[0] === 192 && parts[1] === 168) return true;
    
    // 169.254.0.0/16 - Link-local / Cloud metadata
    if (parts[0] === 169 && parts[1] === 254) return true;
    
    // 127.0.0.0/8 - Loopback
    if (parts[0] === 127) return true;
    
    // 0.0.0.0/8 - Current network
    if (parts[0] === 0) return true;
  }
  
  // IPv6 checks
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // Loopback
    if (lower === '::1') return true;
    // Link-local
    if (lower.startsWith('fe80:')) return true;
    // Unique local (fc00::/7)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  }
  
  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a URL for safe outbound requests (webhook delivery).
 *
 * Checks:
 * 1. Valid URL format
 * 2. Only http/https protocols
 * 3. Not localhost or known local hostnames
 * 4. DNS resolution doesn't point to private IPs (prevents DNS rebinding)
 */
export async function validateWebhookUrl(urlString: string): Promise<UrlValidationResult> {
  let parsed: URL;
  
  // 1. Parse URL
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // 2. Protocol allowlist
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return { 
      valid: false, 
      error: `Protocol "${parsed.protocol}" not allowed. Use http or https.` 
    };
  }

  // 3. Block known localhost hostnames
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.includes(hostname)) {
    return { valid: false, error: 'Localhost URLs are not permitted' };
  }

  // 4. If hostname is a direct IP, check it
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      return { valid: false, error: 'Private/internal IP addresses are not permitted' };
    }
    return { valid: true };
  }

  // 5. Resolve hostname and check all IPs (prevents DNS rebinding)
  try {
    // Try IPv4 first
    const ipv4Addresses = await dns.resolve4(hostname).catch(() => []);
    for (const addr of ipv4Addresses) {
      if (isPrivateIP(addr)) {
        return { 
          valid: false, 
          error: `URL resolves to private IP address (${addr})` 
        };
      }
    }

    // Also check IPv6 if no IPv4
    if (ipv4Addresses.length === 0) {
      const ipv6Addresses = await dns.resolve6(hostname).catch(() => []);
      for (const addr of ipv6Addresses) {
        if (isPrivateIP(addr)) {
          return { 
            valid: false, 
            error: `URL resolves to private IP address (${addr})` 
          };
        }
      }
      
      // If no addresses resolved at all
      if (ipv6Addresses.length === 0) {
        return { valid: false, error: 'Could not resolve hostname' };
      }
    }
  } catch (err) {
    // DNS resolution failed - hostname doesn't exist
    return { valid: false, error: 'Could not resolve hostname' };
  }

  return { valid: true };
}

/**
 * Synchronous check for obviously invalid URLs.
 * Use for quick rejection before async DNS checks.
 */
export function isObviouslyUnsafeUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    
    // Check protocol
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return true;
    
    // Check blocked hosts
    if (BLOCKED_HOSTS.includes(hostname)) return true;
    
    // Check if direct private IP
    if (net.isIP(hostname) && isPrivateIP(hostname)) return true;
    
    // Check for metadata endpoints
    if (hostname === '169.254.169.254') return true;
    if (hostname.endsWith('.internal')) return true;
    
    return false;
  } catch {
    return true;
  }
}
