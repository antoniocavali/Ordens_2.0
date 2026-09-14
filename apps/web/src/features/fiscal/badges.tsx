'use client';

import {
  DOCUMENT_VISIBILITY_LABELS,
  INVOICE_STATUS_LABELS,
  OCCURRENCE_SEVERITY_LABELS,
  OCCURRENCE_STATUS_LABELS,
  type DocumentVisibility,
  type InvoiceStatus,
  type OccurrenceSeverity,
  type OccurrenceStatus,
} from '@ordens/contracts';
import { Badge } from '@ordens/ui';
import { AlertTriangle, Ban, CheckCircle2, CircleDot, Eye, Flag, Lock, Timer, Users, XCircle, type LucideIcon } from 'lucide-react';

type Tone = 'neutral' | 'primary' | 'info' | 'warning' | 'success' | 'danger';

// Ícone + texto em todos os indicadores: a cor nunca é o único sinal.

const INVOICE: Record<InvoiceStatus, { tone: Tone; icon: LucideIcon }> = {
  VALID: { tone: 'success', icon: CheckCircle2 },
  DIVERGENT: { tone: 'warning', icon: AlertTriangle },
  REJECTED: { tone: 'danger', icon: XCircle },
  CANCELLED: { tone: 'neutral', icon: Ban },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const { tone, icon: Icon } = INVOICE[status];
  return (
    <Badge tone={tone} size="sm">
      <Icon /> {INVOICE_STATUS_LABELS[status]}
    </Badge>
  );
}

const OCC_STATUS: Record<OccurrenceStatus, { tone: Tone; icon: LucideIcon }> = {
  OPEN: { tone: 'warning', icon: CircleDot },
  IN_PROGRESS: { tone: 'info', icon: Timer },
  RESOLVED: { tone: 'success', icon: CheckCircle2 },
  CANCELLED: { tone: 'neutral', icon: Ban },
};

export function OccurrenceStatusBadge({ status }: { status: OccurrenceStatus }) {
  const { tone, icon: Icon } = OCC_STATUS[status];
  return (
    <Badge tone={tone} size="sm">
      <Icon /> {OCCURRENCE_STATUS_LABELS[status]}
    </Badge>
  );
}

const SEVERITY_TONE: Record<OccurrenceSeverity, Tone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', CRITICAL: 'danger' };

export function SeverityBadge({ severity }: { severity: OccurrenceSeverity }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]} size="sm">
      <Flag /> {OCCURRENCE_SEVERITY_LABELS[severity]}
    </Badge>
  );
}

const VISIBILITY_ICON: Record<DocumentVisibility, LucideIcon> = { INTERNAL: Lock, FARM: Eye, BUYER: Eye, PARTIES: Users };

export function VisibilityBadge({ visibility }: { visibility: DocumentVisibility }) {
  const Icon = VISIBILITY_ICON[visibility];
  return (
    <Badge tone={visibility === 'INTERNAL' ? 'neutral' : 'primary'} size="sm">
      <Icon /> {DOCUMENT_VISIBILITY_LABELS[visibility]}
    </Badge>
  );
}
