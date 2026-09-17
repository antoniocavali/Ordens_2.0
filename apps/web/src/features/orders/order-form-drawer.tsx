'use client';

import * as AlertDialog from '@radix-ui/react-dialog';
import { FREIGHT_MODES, OPERATION_TYPES, type OrderDetail, type OrderDraftInput } from '@ordens/contracts';
import { AsyncCombobox, Button, cn, Drawer, Field, Input, inputBase, Kbd, Textarea, type ComboOption } from '@ordens/ui';
import { AlertCircle, CheckCircle2, CloudOff, Info, Loader2, Send, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { UploadDropzone } from '@/features/uploads/upload-dropzone';
import { ApiRequestError } from '@/lib/api';
import { mulDec } from '@/lib/decimal';
import { formatMoney, formatTime, parseDecimalInput, toDecimalInput } from '@/lib/format';
import { StatusBadge } from './indicators';
import { useCan } from '@/lib/session';
import { createOrder, lookups, publishOrder, requestPublishOrder, updateOrder, useInvalidateOrders, useUnits } from './orders-api';

// ───────────────────────────── Modelo do formulário ─────────────────────────────

interface FormValues {
  externalNumber: string;
  orderDate: string;
  priority: string;
  operationType: string;
  contract: ComboOption | null;
  seller: ComboOption | null;
  farm: ComboOption | null;
  buyer: ComboOption | null;
  commodity: ComboOption | null;
  cropYear: string;
  quantity: string;
  unitId: string;
  unitPrice: string;
  currency: string;
  freightMode: string;
  freightEstimate: string;
  carrier: ComboOption | null;
  loadingStartsOn: string;
  loadingEndsOn: string;
  tolerancePct: string;
  requiresReceipt: boolean;
  initialReleaseQty: string;
  destinationName: string;
  destinationAddress: string;
  destinationCity: string;
  destinationState: string;
  commercialTerms: string;
  loadingInstructions: string;
  internalNotes: string;
  farmNotes: string;
  buyerNotes: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const opt = (id: string | undefined | null, label: string | undefined | null, meta?: Record<string, string | null>): ComboOption | null =>
  id ? { id, label: label ?? '', meta } : null;

function fromDetail(o: OrderDetail | null): FormValues {
  return {
    externalNumber: o?.externalNumber ?? '',
    orderDate: o?.orderDate ?? today(),
    priority: o?.priority ?? 'NORMAL',
    operationType: o?.operationType ?? 'PURCHASE',
    contract: opt(o?.contract?.id, o?.contract?.number),
    seller: opt(o?.seller?.id, o?.seller?.name),
    farm: opt(o?.farm?.id, o?.farm?.name, { sellerId: o?.seller?.id ?? null, city: o?.farm?.city ?? null, state: o?.farm?.state ?? null }),
    buyer: opt(o?.buyer?.id, o?.buyer?.name),
    commodity: opt(o?.commodity?.id, o?.commodity?.name),
    cropYear: o?.cropYear ?? '',
    quantity: toDecimalInput(o?.quantities.total !== '0' ? o?.quantities.total : ''),
    unitId: o?.unit?.id ?? '',
    unitPrice: toDecimalInput(o?.unitPrice),
    currency: o?.currency ?? 'BRL',
    freightMode: o?.freightMode ?? '',
    freightEstimate: toDecimalInput(o?.freightEstimate),
    carrier: opt(o?.preferredCarrier?.id, o?.preferredCarrier?.name),
    loadingStartsOn: o?.loadingStartsOn ?? '',
    loadingEndsOn: o?.loadingEndsOn ?? '',
    tolerancePct: toDecimalInput(o?.tolerancePct && o.tolerancePct !== '0' ? o.tolerancePct : ''),
    requiresReceipt: o?.requiresReceipt ?? true,
    initialReleaseQty: toDecimalInput(o?.initialReleaseQty),
    destinationName: o?.destinationName ?? '',
    destinationAddress: o?.destinationAddress ?? '',
    destinationCity: o?.destinationCity ?? '',
    destinationState: o?.destinationState ?? '',
    commercialTerms: o?.commercialTerms ?? '',
    loadingInstructions: o?.loadingInstructions ?? '',
    internalNotes: o?.internalNotes ?? '',
    farmNotes: o?.farmNotes ?? '',
    buyerNotes: o?.buyerNotes ?? '',
  };
}

const txt = (v: string) => (v.trim() ? v.trim() : null);
const dec = (v: string) => (v.trim() ? parseDecimalInput(v) || null : null);

function toPayload(v: FormValues): OrderDraftInput {
  return {
    externalNumber: txt(v.externalNumber),
    orderDate: v.orderDate || null,
    priority: v.priority as OrderDraftInput['priority'],
    operationType: (v.operationType || null) as OrderDraftInput['operationType'],
    contractId: v.contract?.id ?? null,
    sellerPartnerId: v.seller?.id ?? null,
    farmId: v.farm?.id ?? null,
    buyerPartnerId: v.buyer?.id ?? null,
    commodityId: v.commodity?.id ?? null,
    cropYear: txt(v.cropYear),
    quantity: dec(v.quantity),
    unitId: v.unitId || null,
    unitPrice: dec(v.unitPrice),
    currency: (v.currency || 'BRL') as 'BRL' | 'USD',
    freightMode: (v.freightMode || null) as OrderDraftInput['freightMode'],
    freightEstimate: dec(v.freightEstimate),
    preferredCarrierId: v.carrier?.id ?? null,
    loadingStartsOn: v.loadingStartsOn || null,
    loadingEndsOn: v.loadingEndsOn || null,
    tolerancePct: dec(v.tolerancePct),
    requiresReceipt: v.requiresReceipt,
    initialReleaseQty: dec(v.initialReleaseQty),
    destinationName: txt(v.destinationName),
    destinationAddress: txt(v.destinationAddress),
    destinationCity: txt(v.destinationCity),
    destinationState: v.destinationState.trim() ? v.destinationState.trim().toUpperCase() : null,
    commercialTerms: txt(v.commercialTerms),
    loadingInstructions: txt(v.loadingInstructions),
    internalNotes: txt(v.internalNotes),
    farmNotes: txt(v.farmNotes),
    buyerNotes: txt(v.buyerNotes),
  };
}

/** Mapeia nomes de campos da API para campos do formulário. */
const API_TO_FORM: Record<string, keyof FormValues> = {
  contractId: 'contract',
  sellerPartnerId: 'seller',
  farmId: 'farm',
  buyerPartnerId: 'buyer',
  commodityId: 'commodity',
  preferredCarrierId: 'carrier',
};

const SECTIONS = [
  { id: 'identificacao', label: 'Identificação' },
  { id: 'comercial', label: 'Comercial' },
  { id: 'quantidades', label: 'Quantidades' },
  { id: 'origem-destino', label: 'Origem e destino' },
  { id: 'logistica', label: 'Logística' },
  { id: 'documentos', label: 'Documentos' },
  { id: 'observacoes', label: 'Observações' },
] as const;

const FIELD_SECTION: Partial<Record<keyof FormValues, (typeof SECTIONS)[number]['id']>> = {
  contract: 'comercial',
  seller: 'comercial',
  buyer: 'comercial',
  commodity: 'comercial',
  farm: 'origem-destino',
  quantity: 'quantidades',
  unitId: 'quantidades',
  unitPrice: 'quantidades',
  initialReleaseQty: 'logistica',
  loadingStartsOn: 'logistica',
  loadingEndsOn: 'logistica',
};

type SaveState = { status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'; at?: string; message?: string };

// ───────────────────────────── Componente ─────────────────────────────

export function OrderFormDrawer({ open, order, onClose, onPublished }: { open: boolean; order: OrderDetail | null; onClose: () => void; onPublished?: (o: OrderDetail) => void }) {
  const [current, setCurrent] = useState<OrderDetail | null>(order);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const [confirmClose, setConfirmClose] = useState(false);
  const invalidate = useInvalidateOrders();
  const can = useCan();
  const scrollRef = useRef<HTMLDivElement>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const currentRef = useRef<OrderDetail | null>(order);
  const skipAutosave = useRef(true);

  const form = useForm<FormValues>({ defaultValues: fromDetail(order) });
  const isDraft = !current || current.status === 'DRAFT';

  useEffect(() => {
    if (!open) return;
    setCurrent(order);
    currentRef.current = order;
    form.reset(fromDetail(order));
    setSave({ status: order ? 'saved' : 'idle', at: order?.updatedAt });
    setNotice(null);
    skipAutosave.current = true;
    scrollRef.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id]);

  const applyServerErrors = useCallback(
    (err: unknown) => {
      if (!(err instanceof ApiRequestError)) return;
      const fields = err.fieldErrors;
      let first: keyof FormValues | null = null;
      for (const [apiField, messages] of Object.entries(fields)) {
        const name = (API_TO_FORM[apiField] ?? apiField) as keyof FormValues;
        form.setError(name, { type: 'server', message: messages[0] });
        first ??= name;
      }
      const section = first ? FIELD_SECTION[first] : null;
      if (section) document.getElementById(`secao-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [form],
  );

  /** Salva (criação ou atualização) de forma serializada — nunca dois PATCH concorrentes. */
  const persist = useCallback(
    (reason: 'auto' | 'manual') => {
      const run = async () => {
        const values = form.getValues();
        const payload = toPayload(values);
        const existing = currentRef.current;
        if (!existing && reason === 'auto' && !payload.sellerPartnerId && !payload.buyerPartnerId && !payload.contractId && !payload.commodityId) return existing;
        setSave({ status: 'saving' });
        try {
          const saved = existing ? await updateOrder(existing.id, existing.version, existing.updatedAt, payload) : await createOrder(payload);
          currentRef.current = saved;
          setCurrent(saved);
          form.clearErrors();
          setSave({ status: 'saved', at: saved.updatedAt });
          invalidate(saved);
          return saved;
        } catch (err) {
          const message = err instanceof ApiRequestError ? err.message : 'Não foi possível salvar.';
          setSave({ status: 'error', message });
          applyServerErrors(err);
          if (reason === 'manual') throw err;
          return existing;
        }
      };
      const next = queue.current.then(run, run);
      queue.current = next.catch(() => undefined);
      return next;
    },
    [form, invalidate, applyServerErrors],
  );

  // Autosave de rascunhos (debounce 1,2 s).
  const watched = useWatch({ control: form.control });
  useEffect(() => {
    if (!open) return;
    if (skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    if (!form.formState.isDirty && !currentRef.current) return;
    setSave((s) => (s.status === 'saving' ? s : { ...s, status: 'dirty' }));
    if (!isDraft) return;
    const t = setTimeout(() => void persist('auto'), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched]);

  // Publicar direto ou pedir a publicação (Q40): sem order.publish, ou barrado pela dupla checagem após salvar.
  const canPublish = can('order.publish');
  const requestOnly = !canPublish || Boolean(current?.workflow?.blockedByFourEyes);

  const publish = useCallback(async () => {
    setPublishing(true);
    try {
      const saved = (await persist('manual')) as OrderDetail | null;
      if (!saved) throw new ApiRequestError(422, 'PUBLISH_REQUIREMENTS_MISSING', 'Preencha os dados comerciais antes de publicar.');
      if (!saved.allowedActions.includes('publish') && saved.allowedActions.includes('request_publish')) {
        const requested = await requestPublishOrder(saved.id, saved.updatedAt);
        invalidate(requested);
        toast.success(`Publicação da ordem ${requested.number} solicitada`, {
          description: saved.workflow?.blockedByFourEyes ? 'Dupla checagem ativa: outra pessoa com permissão vai revisar e publicar.' : 'Quem pode publicar foi avisado.',
        });
        onClose();
        return;
      }
      const published = await publishOrder(saved.id, saved.updatedAt);
      invalidate(published);
      toast.success(`Ordem ${published.number} publicada`, { description: 'Fazenda e comprador foram notificados.' });
      onPublished?.(published);
      onClose();
    } catch (err) {
      applyServerErrors(err);
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível publicar.');
    } finally {
      setPublishing(false);
    }
  }, [persist, invalidate, onPublished, onClose, applyServerErrors]);

  const saveChanges = useCallback(async () => {
    try {
      const saved = (await persist('manual')) as OrderDetail | null;
      if (saved) {
        toast.success(isDraft ? 'Rascunho salvo' : `Alterações salvas · versão ${saved.version}`);
        if (!isDraft) onClose();
      }
    } catch {
      /* erros já exibidos */
    }
  }, [persist, isDraft, onClose]);

  const requestClose = useCallback(async () => {
    if (isDraft && (save.status === 'dirty' || save.status === 'saving')) {
      await persist('auto').catch(() => undefined);
      if (currentRef.current) toast('Rascunho salvo automaticamente', { description: currentRef.current.number });
      onClose();
      return;
    }
    if (save.status === 'error' || (!isDraft && form.formState.isDirty)) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }, [isDraft, save.status, persist, onClose, form.formState.isDirty]);

  // Atalhos: Ctrl+S salva, Ctrl+Enter publica.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveChanges();
      } else if (e.key === 'Enter' && isDraft) {
        e.preventDefault();
        void publish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saveChanges, publish, isDraft]);

  // Scrollspy das seções.
  useEffect(() => {
    const root = scrollRef.current;
    if (!open || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSection(visible.target.id.replace('secao-', ''));
      },
      { root, rootMargin: '0px 0px -65% 0px' },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(`secao-${s.id}`);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [open]);

  const title = current ? (isDraft ? 'Rascunho de Ordem' : 'Editar Ordem') : 'Nova Ordem de Carregamento';

  return (
    <>
      <Drawer
        open={open}
        bodyScroll={false}
        onRequestClose={() => void requestClose()}
        title={
          <span className="flex items-center gap-2.5">
            {title}
            {current ? <span className="font-mono text-sm font-medium text-muted">{current.number}</span> : null}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {current ? <StatusBadge status={current.status} size="sm" /> : <span className="text-subtle">O número é gerado ao salvar</span>}
            {!isDraft ? <span className="text-warning">Alterações relevantes geram a versão {current!.version + 1}</span> : null}
          </span>
        }
        headerAside={<SaveIndicator state={save} isDraft={isDraft} />}
        toolbar={
          <nav aria-label="Seções do formulário" className="-mb-px flex gap-1 overflow-x-auto">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => document.getElementById(`secao-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className={cn(
                  'relative whitespace-nowrap px-2.5 pb-2.5 pt-1 text-[13px] font-medium transition-colors',
                  activeSection === s.id ? 'text-primary' : 'text-muted hover:text-text',
                )}
              >
                {s.label}
                {activeSection === s.id ? <motion.span layoutId="drawer-tab" className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
              </button>
            ))}
          </nav>
        }
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <div className="hidden items-center gap-1.5 text-xs text-subtle md:flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>S</Kbd> salvar
              {isDraft ? (
                <>
                  <span className="mx-1">·</span>
                  <Kbd>Ctrl</Kbd>
                  <Kbd>Enter</Kbd> publicar
                </>
              ) : null}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={() => void requestClose()}>
                {isDraft ? 'Fechar' : 'Cancelar'}
              </Button>
              <Button variant="outline" onClick={() => void saveChanges()} loading={save.status === 'saving' && !publishing}>
                {isDraft ? 'Salvar rascunho' : 'Salvar alterações'}
              </Button>
              {isDraft ? (
                <Button onClick={() => void publish()} loading={publishing}>
                  {!publishing ? <Send /> : null} {requestOnly ? 'Salvar e solicitar publicação' : 'Salvar e publicar'}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain">
          <form onSubmit={(e) => e.preventDefault()} className="space-y-1 px-5 py-5 sm:px-7" noValidate>
            <AnimatePresence>
              {notice ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2.5 text-[13px] text-warning"
                  role="status"
                >
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <span className="flex-1">{notice}</span>
                  <button type="button" className="text-xs font-medium underline" onClick={() => setNotice(null)}>
                    Ok
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
            <OrderFormSections form={form} orderId={current?.id ?? null} onNotice={setNotice} isDraft={isDraft} />
          </form>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmClose}
        title="Descartar alterações?"
        description="Há alterações não salvas nesta ordem. Se sair agora, elas serão perdidas."
        confirmLabel="Descartar e fechar"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          onClose();
        }}
      />
    </>
  );
}

function SaveIndicator({ state, isDraft }: { state: SaveState; isDraft: boolean }) {
  const content: Record<SaveState['status'], ReactNode> = {
    idle: isDraft ? (
      <>
        <Sparkles className="size-3.5" /> Salvamento automático
      </>
    ) : null,
    dirty: isDraft ? <>Alterações pendentes…</> : <>Alterações não salvas</>,
    saving: (
      <>
        <Loader2 className="size-3.5 animate-spin" /> Salvando…
      </>
    ),
    saved: (
      <>
        <CheckCircle2 className="size-3.5 text-success" /> Salvo {state.at ? `às ${formatTime(state.at)}` : ''}
      </>
    ),
    error: (
      <>
        <CloudOff className="size-3.5 text-danger" /> <span className="text-danger">Erro ao salvar</span>
      </>
    ),
  };
  if (!content[state.status]) return null;
  return (
    <motion.div key={state.status} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} className="mt-1 hidden items-center gap-1.5 whitespace-nowrap text-xs text-muted sm:flex" aria-live="polite" title={state.message}>
      {content[state.status]}
    </motion.div>
  );
}

// ───────────────────────────── Seções ─────────────────────────────

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={`secao-${id}`} className="scroll-mt-2 border-b border-border/60 py-6 first:pt-1 last:border-0">
      <div className="mb-4">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-primary">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-subtle">{description}</p> : null}
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-6">{children}</div>
    </section>
  );
}

const col = { 2: 'sm:col-span-2', 3: 'sm:col-span-3', 4: 'sm:col-span-4', 6: 'sm:col-span-6' } as const;

function Select({ options, placeholder, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...props} className={cn(inputBase, 'h-9 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8', props.className)} style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%238a86a0%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")' }}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const OPERATION_LABEL: Record<string, string> = { PURCHASE: 'Compra', SALE: 'Venda', TRANSFER: 'Transferência', STORAGE: 'Armazenagem' };
const FREIGHT_LABEL: Record<string, string> = { CIF: 'CIF', FOB: 'FOB', THIRD_PARTY: 'Terceiros', TO_DEFINE: 'A definir' };
const PRIORITY_LABEL: Record<string, string> = { LOW: 'Baixa', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' };

function OrderFormSections({ form, orderId, onNotice, isDraft }: { form: UseFormReturn<FormValues>; orderId: string | null; onNotice: (m: string | null) => void; isDraft: boolean }) {
  const { control, register, setValue, formState } = form;
  const errors = formState.errors;
  const [contract, seller, farm, buyer, quantity, unitPrice, unitId, currency] = useWatch({
    control,
    name: ['contract', 'seller', 'farm', 'buyer', 'quantity', 'unitPrice', 'unitId', 'currency'],
  });
  const units = useUnits();
  const unitLabel = units.data?.find((u) => u.id === unitId)?.label ?? '';

  const estimated = useMemo(() => mulDec(parseDecimalInput(quantity), parseDecimalInput(unitPrice), 2), [quantity, unitPrice]);
  const err = (name: keyof FormValues) => errors[name]?.message as string | undefined;
  const dirty = { shouldDirty: true, shouldValidate: false } as const;

  // Unidade padrão (t) quando vazia.
  useEffect(() => {
    if (!form.getValues('unitId') && units.data?.length) {
      const t = units.data.find((u) => u.meta?.code === 'T') ?? units.data[0];
      if (t) setValue('unitId', t.id);
    }
  }, [units.data, form, setValue]);

  /** Vendedor mudou: fazenda incompatível é limpa COM aviso (nunca silenciosamente). */
  const onSellerChange = (next: ComboOption | null) => {
    const currentFarm = form.getValues('farm');
    setValue('seller', next, dirty);
    form.clearErrors(['seller', 'farm']);
    if (currentFarm && currentFarm.meta?.sellerId !== next?.id) {
      setValue('farm', null, dirty);
      onNotice(next ? `${currentFarm.label} não pertence a ${next.label}. Selecione a fazenda novamente.` : `A fazenda ${currentFarm.label} foi removida porque o vendedor foi limpo.`);
    }
    const c = form.getValues('contract');
    if (c && next && c.meta?.sellerId !== next.id) {
      setValue('contract', null, dirty);
      onNotice(`O contrato ${c.label} é de outro vendedor e foi removido.`);
    }
  };

  /** Contrato define vendedor, comprador, commodity e condições. */
  const onContractChange = (next: ComboOption | null) => {
    setValue('contract', next, dirty);
    form.clearErrors(['contract', 'seller', 'buyer', 'commodity']);
    if (!next?.meta) return;
    const m = next.meta;
    const prevSeller = form.getValues('seller');
    if (m.sellerId) setValue('seller', { id: m.sellerId, label: m.sellerName ?? '' }, dirty);
    if (m.buyerId) setValue('buyer', { id: m.buyerId, label: m.buyerName ?? '' }, dirty);
    if (m.commodityId) setValue('commodity', { id: m.commodityId, label: m.commodityName ?? '' }, dirty);
    if (m.unitId) setValue('unitId', m.unitId, dirty);
    if (m.unitPrice && !form.getValues('unitPrice')) setValue('unitPrice', toDecimalInput(m.unitPrice), dirty);
    if (m.currency) setValue('currency', m.currency, dirty);
    if (m.cropYear && !form.getValues('cropYear')) setValue('cropYear', m.cropYear, dirty);
    if (m.freightMode && !form.getValues('freightMode')) setValue('freightMode', m.freightMode, dirty);
    const f = form.getValues('farm');
    if (f && f.meta?.sellerId && f.meta.sellerId !== m.sellerId) {
      setValue('farm', null, dirty);
      onNotice(`${f.label} não pertence ao vendedor do contrato (${m.sellerName}). Selecione a fazenda novamente.`);
    } else if (prevSeller && prevSeller.id !== m.sellerId) {
      onNotice(`Vendedor ajustado para ${m.sellerName} conforme o contrato ${next.label}.`);
    }
  };

  const onFarmChange = (next: ComboOption | null) => {
    setValue('farm', next, dirty);
    form.clearErrors('farm');
  };

  return (
    <>
      <Section id="identificacao" title="Identificação">
        <Field label="Nº da ordem" className={col[2]} hint="Gerado automaticamente">
          {(a) => <Input {...a} disabled value={orderId ? '' : ''} placeholder="Automático" />}
        </Field>
        <Field label="Data da ordem" className={col[2]}>
          {(a) => <Input {...a} type="date" {...register('orderDate')} />}
        </Field>
        <Field label="Prioridade" className={col[2]}>
          {(a) => <Select {...a} {...register('priority')} options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))} />}
        </Field>
        <Field label="Tipo de operação" className={col[3]}>
          {(a) => <Select {...a} {...register('operationType')} options={OPERATION_TYPES.map((v) => ({ value: v, label: OPERATION_LABEL[v] ?? v }))} />}
        </Field>
        <Field label="Número externo" className={col[3]} hint="Referência do ERP ou do cliente, se houver">
          {(a) => <Input {...a} {...register('externalNumber')} placeholder="Opcional" />}
        </Field>
      </Section>

      <Section id="comercial" title="Comercial" description="Ao escolher um contrato, vendedor, comprador e commodity são preenchidos e travados às partes do contrato.">
        <Field label="Contrato" className={col[6]} error={err('contract')} hint={contract?.description ?? 'Opcional — sem contrato, informe as partes manualmente'}>
          {(a) => (
            <Controller
              control={control}
              name="contract"
              render={({ field }) => (
                <AsyncCombobox
                  {...a}
                  value={field.value}
                  onChange={onContractChange}
                  queryKey={['lookup', 'contracts']}
                  fetchPage={lookups.contracts({})}
                  placeholder="Pesquisar contrato por número, parte ou commodity…"
                />
              )}
            />
          )}
        </Field>
        <Field label="Vendedor" required className={col[3]} error={err('seller')}>
          {(a) => (
            <Controller
              control={control}
              name="seller"
              render={({ field }) => (
                <AsyncCombobox {...a} value={field.value} onChange={onSellerChange} queryKey={['lookup', 'sellers', contract?.id ?? null]} fetchPage={lookups.sellers(contract?.id)} placeholder="Pesquisar vendedor…" />
              )}
            />
          )}
        </Field>
        <Field label="Comprador" required className={col[3]} error={err('buyer')}>
          {(a) => (
            <Controller
              control={control}
              name="buyer"
              render={({ field }) => (
                <AsyncCombobox
                  {...a}
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v);
                    form.clearErrors('buyer');
                  }}
                  queryKey={['lookup', 'buyers', contract?.id ?? null]}
                  fetchPage={lookups.buyers(contract?.id)}
                  placeholder="Pesquisar comprador…"
                />
              )}
            />
          )}
        </Field>
        <Field label="Commodity" required className={col[3]} error={err('commodity')}>
          {(a) => (
            <Controller
              control={control}
              name="commodity"
              render={({ field }) => (
                <AsyncCombobox
                  {...a}
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v);
                    form.clearErrors('commodity');
                    if (v?.meta?.defaultUnitId && !form.getValues('unitId')) setValue('unitId', v.meta.defaultUnitId, dirty);
                  }}
                  queryKey={['lookup', 'commodities', contract?.id ?? null]}
                  fetchPage={lookups.commodities(contract?.id)}
                  placeholder="Milho, soja, algodão…"
                />
              )}
            />
          )}
        </Field>
        <Field label="Safra" className={col[3]} error={err('cropYear')}>
          {(a) => <Input {...a} {...register('cropYear')} placeholder="25/26" />}
        </Field>
      </Section>

      <Section id="quantidades" title="Quantidades e valores" description="Valores decimais exatos — sem arredondamento de ponto flutuante.">
        <Field label="Quantidade" required className={col[2]} error={err('quantity')}>
          {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...register('quantity')} placeholder="0,000" />}
        </Field>
        <Field label="Unidade" required className="sm:col-span-1" error={err('unitId')}>
          {(a) => <Select {...a} {...register('unitId')} options={(units.data ?? []).map((u) => ({ value: u.id, label: u.label }))} />}
        </Field>
        <Field label={`Preço${unitLabel ? ` / ${unitLabel}` : ''}`} className={col[2]} error={err('unitPrice')}>
          {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...register('unitPrice')} placeholder="0,00" />}
        </Field>
        <Field label="Moeda" className={col[2]}>
          {(a) => <Select {...a} {...register('currency')} options={[{ value: 'BRL', label: 'BRL — Real' }, { value: 'USD', label: 'USD — Dólar' }]} />}
        </Field>
        <div className="flex flex-col justify-end sm:col-span-4">
          <div className="flex h-[58px] items-center justify-between rounded-lg bg-primary-soft/60 px-4 ring-1 ring-primary/15">
            <span className="text-[12.5px] font-medium text-muted">Valor estimado do produto</span>
            <motion.span key={estimated ?? 'x'} initial={{ opacity: 0.4, y: 2 }} animate={{ opacity: 1, y: 0 }} className="text-lg font-semibold text-primary tabular">
              {estimated ? formatMoney(estimated, currency) : '—'}
            </motion.span>
          </div>
        </div>
      </Section>

      <Section id="origem-destino" title="Origem e destino">
        <Field
          label="Fazenda / propriedade"
          required
          className={col[3]}
          error={err('farm')}
          hint={seller ? `Filtrada por ${seller.label}` : undefined}
        >
          {(a) => (
            <Controller
              control={control}
              name="farm"
              render={({ field }) => (
                <AsyncCombobox
                  {...a}
                  value={field.value}
                  onChange={onFarmChange}
                  disabled={!seller}
                  disabledHint="Selecione o vendedor primeiro"
                  queryKey={['lookup', 'farms', seller?.id ?? null]}
                  fetchPage={lookups.farms(seller?.id ?? '')}
                  placeholder="Pesquisar fazenda do vendedor…"
                  emptyText="Este vendedor não possui fazendas cadastradas"
                />
              )}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <span className="text-[12.5px] font-medium text-muted">Município de origem</span>
          <div className="flex h-9 items-center rounded-md px-3 text-sm text-muted ring-1 ring-inset ring-border">
            {farm?.meta?.city ? `${farm.meta.city}/${farm.meta.state}` : '—'}
          </div>
        </div>
        <Field label="Local cadastrado" className={col[6]} hint="Preenche o destino abaixo; você ainda pode ajustar os campos nesta ordem.">
          {(a) => (
            <AsyncCombobox
              {...a}
              value={null}
              onChange={(v) => {
                if (!v?.meta) return;
                setValue('destinationName', v.meta.name ?? v.label, dirty);
                setValue('destinationCity', v.meta.city ?? '', dirty);
                setValue('destinationState', v.meta.state ?? '', dirty);
                setValue('destinationAddress', v.meta.address ?? '', dirty);
              }}
              queryKey={['lookup', 'locations', buyer?.id ?? null]}
              fetchPage={lookups.locations(buyer?.id)}
              placeholder={buyer ? `Buscar local de ${buyer.label} ou de uso geral…` : 'Buscar armazém, porto ou indústria…'}
              emptyText="Nenhum local cadastrado. Cadastre em Cadastros > Locais."
            />
          )}
        </Field>
        <Field label="Destino / unidade de recebimento" className={col[3]}>
          {(a) => <Input {...a} {...register('destinationName')} placeholder={buyer ? `Unidade de ${buyer.label}` : 'Ex.: Fábrica Chapecó'} />}
        </Field>
        <Field label="Cidade" className={col[2]}>
          {(a) => <Input {...a} {...register('destinationCity')} />}
        </Field>
        <Field label="UF" className="sm:col-span-1">
          {(a) => <Input {...a} maxLength={2} className="uppercase" {...register('destinationState')} />}
        </Field>
        <Field label="Endereço de entrega" className={col[6]}>
          {(a) => <Input {...a} {...register('destinationAddress')} />}
        </Field>
      </Section>

      <Section id="logistica" title="Logística" description="Motorista, veículo e placas são definidos no agendamento de cada carga — não na ordem.">
        <Field label="Início do carregamento" required className={col[2]} error={err('loadingStartsOn')}>
          {(a) => <Input {...a} type="date" {...register('loadingStartsOn')} />}
        </Field>
        <Field label="Data limite" required className={col[2]} error={err('loadingEndsOn')}>
          {(a) => <Input {...a} type="date" {...register('loadingEndsOn')} />}
        </Field>
        <Field label="Tolerância (%)" className={col[2]} error={err('tolerancePct')} hint="Excedente permitido sobre a quantidade">
          {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...register('tolerancePct')} placeholder="0" />}
        </Field>
        <Field label="Transportadora preferencial" className={col[3]}>
          {(a) => (
            <Controller
              control={control}
              name="carrier"
              render={({ field }) => <AsyncCombobox {...a} value={field.value} onChange={field.onChange} queryKey={['lookup', 'carriers']} fetchPage={lookups.carriers()} placeholder="Transportadora a definir" />}
            />
          )}
        </Field>
        <Field label="Modalidade de frete" className={col[3]}>
          {(a) => <Select {...a} {...register('freightMode')} placeholder="Selecionar…" options={FREIGHT_MODES.map((v) => ({ value: v, label: FREIGHT_LABEL[v] ?? v }))} />}
        </Field>
        <Field label="Frete estimado (R$)" className={col[3]}>
          {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...register('freightEstimate')} placeholder="0,00" />}
        </Field>
        <Field
          label={isDraft ? 'Liberação inicial na publicação' : 'Liberação inicial'}
          className={col[3]}
          error={err('initialReleaseQty')}
          hint={isDraft ? 'Cria a Liberação 01 automaticamente ao publicar' : 'Novas liberações são feitas no detalhe da ordem'}
        >
          {(a) => <Input {...a} inputMode="decimal" disabled={!isDraft} className="text-right tabular" {...register('initialReleaseQty')} placeholder="0,000" />}
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 ring-1 ring-border hover:bg-surface-2 sm:col-span-6">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" {...register('requiresReceipt')} />
          <span className="min-w-0 text-sm">
            <span className="block font-medium">Exigir recebimento no destino</span>
            <span className="block text-xs text-muted">
              Desmarcado, a carga segue do trânsito direto para o faturamento da Matriz, sem registrar chegada, quantidade recebida e conferência.
            </span>
          </span>
        </label>
      </Section>

      <Section id="documentos" title="Documentos e instruções">
        <div className="sm:col-span-6">
          <UploadDropzone entityId={orderId} disabledReason="Preencha o vendedor ou comprador para salvar o rascunho e anexar documentos" />
        </div>
        <Field label="Instruções de carregamento" className={col[6]}>
          {(a) => <Textarea {...a} rows={3} {...register('loadingInstructions')} placeholder="Umidade máxima, impurezas, documentos exigidos na portaria…" />}
        </Field>
        <Field label="Condições comerciais" className={col[6]}>
          {(a) => <Textarea {...a} rows={2} {...register('commercialTerms')} />}
        </Field>
      </Section>

      <Section id="observacoes" title="Observações" description="Cada observação tem visibilidade própria.">
        <Field label="Observação interna da Matriz" className={col[6]} hint="Visível apenas para a Matriz">
          {(a) => <Textarea {...a} rows={2} {...register('internalNotes')} />}
        </Field>
        <Field label="Observação para a Fazenda" className={col[3]}>
          {(a) => <Textarea {...a} rows={3} {...register('farmNotes')} />}
        </Field>
        <Field label="Observação para o Comprador" className={col[3]}>
          {(a) => <Textarea {...a} rows={3} {...register('buyerNotes')} />}
        </Field>
      </Section>

      {Object.keys(errors).length ? (
        <div className="flex items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
          <AlertCircle className="size-4" /> Revise os campos destacados.
        </div>
      ) : null}
    </>
  );
}

// ───────────────────────────── Confirmação ─────────────────────────────

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-[var(--overlay)] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface p-6 shadow-lg ring-1 ring-border data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95">
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted">{description}</AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Continuar editando
            </Button>
            <Button variant="danger" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
