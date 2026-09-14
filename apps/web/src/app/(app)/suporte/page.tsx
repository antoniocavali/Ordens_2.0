import { redirect } from 'next/navigation';

/** Rota antiga do painel: mantém links de notificações já enviadas. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value ? [value] : []) params.append(key, v);
  }
  redirect(params.size ? `/atendimento?${params}` : '/atendimento');
}
