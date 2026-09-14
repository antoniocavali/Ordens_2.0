'use client';

import { Suspense } from 'react';
import { SupportPanel } from '@/features/support/support-panel';

export default function Page() {
  return (
    <Suspense>
      <SupportPanel key="BILLING" team="BILLING" />
    </Suspense>
  );
}
