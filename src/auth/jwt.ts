import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { JWTPayload } from '../types';

/**
 * Verify a Cloudflare Access JWT token using the jose library.
 *
 * This follows Cloudflare's recommended approach:
 * https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#cloudflare-workers-example
 *
 * @param token - The JWT token string
 * @param teamDomain - The Cloudflare Access team domain (e.g., 'myteam.cloudflareaccess.com')
 * @param expectedAud - The expected audience (Application AUD tag)
 * @returns The decoded JWT payload if valid
 * @throws Error if the token is invalid, expired, or doesn't match expected values
 */
export async function verifyAccessJWT(
  token: string,
  teamDomain: string,
  expectedAud: string,
): Promise<JWTPayload> {
  // Ensure teamDomain has https:// prefix for issuer check
  const issuer = teamDomain.startsWith('https://') ? teamDomain : `https://${teamDomain}`;

  // Create JWKS from the team domain
  const JWKS = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

  // Add a timeout to prevent indefinite hangs if the JWKS endpoint is unreachable.
  // Without this, a network issue between the Worker and CF Access causes ALL
  // authenticated requests to hang forever.
  const verifyPromise = jwtVerify(token, JWKS, {
    issuer,
    audience: expectedAud,
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('JWT verification timed out (10s)')), 10_000);
  });

  const { payload } = await Promise.race([verifyPromise, timeoutPromise]);

  // Cast to our JWTPayload type
  return payload as unknown as JWTPayload;
}
