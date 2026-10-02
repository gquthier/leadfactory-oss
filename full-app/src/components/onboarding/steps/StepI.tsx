"use client";
import type {OnboardingData} from '@/types/onboarding';
export function StepI({data,onChange}:{data:OnboardingData;onChange:(patch:Partial<OnboardingData>)=>void}){
 return <section className="space-y-6"><h2 className="text-2xl font-black uppercase">I — Contact et validation</h2><p>Renseignez le contact qui relira la proposition. Aucun mot de passe n’est demandé dans le brief.</p><label className="block font-bold">Email du contact<input className="input-brutal mt-2" type="email" value={data.i_email} onChange={e=>onChange({i_email:e.target.value})}/></label><p className="text-sm text-lf-gray">La soumission enregistre le brief dans le logiciel local. Elle n’envoie aucun message et ne lance aucune campagne publicitaire.</p></section>;
}
