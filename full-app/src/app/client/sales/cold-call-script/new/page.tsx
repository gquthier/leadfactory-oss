import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { createConversation } from "@/lib/cold-call-script-writer/chat-data";

export const dynamic = "force-dynamic";

/**
 * Crée une conversation vide et redirige vers /[id] — pas de form intermédiaire.
 * L'utilisateur écrit son premier message dans le chat de la page suivante,
 * et l'IA pull le contexte client automatiquement.
 */
export default async function NewColdCallConversationPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const conv = await createConversation(session.user.id);
  redirect(`/client/sales/cold-call-script/${conv.id}`);
}
