'use client';

import { Suspense } from 'react';
import { LoadsPage } from '@/features/logistics/loads-page';

export default function Page() {
  return (
    <Suspense>
      <LoadsPage />
    </Suspense>
  );
}
