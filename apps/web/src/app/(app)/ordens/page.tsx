'use client';

import { Suspense } from 'react';
import { OrdersCenter } from '@/features/orders/orders-center';
import { PageLoading } from '@/components/shell/page-loading';

export default function OrdersPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <OrdersCenter />
    </Suspense>
  );
}
