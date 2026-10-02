import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Page legacy : la gestion de la clé Fathom a été déplacée dans les paramètres
 * client globaux (onglet Intégrations). On redirige les liens existants.
 */
export default function FathomSettingsRedirect() {
  redirect("/client/settings?tab=integrations");
}
