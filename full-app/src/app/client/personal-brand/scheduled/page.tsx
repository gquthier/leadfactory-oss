import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar } from "lucide-react";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { ScheduledHubClient } from "./ScheduledHubClient";
import type { ScheduledPostRow } from "@/components/personal-brand/calendar/calendar-utils";

export const dynamic = "force-dynamic";

export default async function ScheduledPostsPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();

  const [postsRes, connRes] = await Promise.all([
    admin
      .from("scheduled_posts")
      .select(
        "id, source_type, body_snapshot, scheduled_at, status, retry_count, linkedin_post_urn, error_message, published_at, created_at"
      )
      .eq("client_id", session.user.id)
      .order("scheduled_at", { ascending: false })
      .limit(200),
    admin
      .from("linkedin_connections")
      .select("linkedin_user_id, full_name, profile_picture, refresh_expires_at, expires_at")
      .eq("client_id", session.user.id)
      .maybeSingle(),
  ]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl">
      <Link
        href="/client/personal-brand"
        className="inline-flex items-center gap-2 text-sm font-bold text-lf-gray hover:text-black mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Personal Brand
      </Link>

      <div className="mb-6">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">PROGRAMMÉS</div>
        <h1 className="text-3xl font-black uppercase tracking-tight flex items-center gap-3">
          <Calendar className="w-7 h-7" /> Posts LinkedIn programmés
        </h1>
        <p className="text-lf-gray font-medium mt-2 max-w-2xl">
          Vue calendrier de vos posts à publier sur LinkedIn. Cliquez sur un créneau pour
          programmer un nouveau post, cliquez sur un post existant pour le modifier.
        </p>
      </div>

      <ScheduledHubClient
        initialPosts={(postsRes.data ?? []) as ScheduledPostRow[]}
        connection={connRes.data}
      />
    </div>
  );
}
