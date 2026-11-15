import { handleAuthentication } from "@/features/auth/server/auth-handler";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const GET = handleAuthentication;

export const POST = handleAuthentication;
