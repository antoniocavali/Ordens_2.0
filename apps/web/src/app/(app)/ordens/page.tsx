'use client';

import { Suspense } from 'react';
import { OrdersCenter } from '@/features/orders/orders-center';

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersCenter />
    </Suspense>
  );
}
