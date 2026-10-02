import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("notify_new_lead, notify_new_lead_email")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    notify_new_lead: data?.notify_new_lead ?? true,
    notify_new_lead_email: data?.notify_new_lead_email ?? true,
  });
}

interface PatchBody {
  notify_new_lead?: boolean;
  notify_new_lead_email?: boolean;
}

export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, boolean> = {};
  if (typeof body.notify_new_lead === "boolean") update.notify_new_lead = body.notify_new_lead;
  if (typeof body.notify_new_lead_email === "boolean")
    update.notify_new_lead_email = body.notify_new_lead_email;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid preference field provided" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update(update)
    .eq("id", session.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ updated: true, preferences: update });
}
