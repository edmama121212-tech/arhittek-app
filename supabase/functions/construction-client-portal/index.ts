// Custom 256-bit scoped bearer authentication is enforced by the gateway and SQL.
// Deploy this function with verify_jwt=false; the bearer is NOT a Supabase JWT.
import '../../../construction-finance.js';
import '../../../client-portal.js';
import '../../../client-portal-gateway.js';
const runtime = globalThis as typeof globalThis & {
 ARHITTEKConstructionFinance: unknown;
 ARHITTEKClientPortal: {validateSnapshot: unknown};
 ARHITTEKClientGateway: {createHandler: (options: Record<string, unknown>) => (request: Request) => Promise<Response>};
};
const url = Deno.env.get('SUPABASE_URL') || '';
const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
let secret = legacy;
if (!secret && modern) { try { secret = JSON.parse(modern).default; } catch { /* Fail closed at startup. */ } }
const handler = runtime.ARHITTEKClientGateway.createHandler({supabaseUrl: url, serviceKey: secret,
 finance: runtime.ARHITTEKConstructionFinance, validate: runtime.ARHITTEKClientPortal.validateSnapshot});
Deno.serve(handler);
