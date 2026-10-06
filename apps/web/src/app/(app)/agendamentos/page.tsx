import { redirect } from 'next/navigation';

/** Tela removida: liberações e agendamentos não existem mais. Links antigos caem na lista de ordens. */
export default function Page() {
  redirect('/ordens');
}
