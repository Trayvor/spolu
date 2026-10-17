import { ListSkeleton } from '@/components/ui/skeleton';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AddAdminBodySchema, type Admin } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { useSession } from '@/features/auth/use-session';
import { addAdmin, adminsQuery, removeAdmin } from './api';

/** Admins list with an inline add form and an inline remove confirmation (no modals). */
export function AdminsPage() {
  const { t } = useTranslation();
  const me = useSession();
  const { data: admins, isError, refetch } = useQuery(adminsQuery);
  const [formOpen, setFormOpen] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <div className="flex flex-col gap-4 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between">
        <h1 className="text-medium leading-tight font-semibold">{t('admins.title')}</h1>
        {!formOpen && (
          <Button
            className="w-full min-[641px]:w-auto"
            onClick={() => {
              setAdded(null);
              setFormOpen(true);
            }}
          >
            {t('admins.add')}
          </Button>
        )}
      </div>

      {formOpen && (
        <AddAdminForm
          onCancel={() => setFormOpen(false)}
          onAdded={(name) => {
            setFormOpen(false);
            setAdded(name);
          }}
        />
      )}
      {/* Always mounted, so screen readers announce the text when it is filled in. */}
      <p role="status" className="text-button empty:hidden">
        {added ? t('admins.added', { name: added }) : null}
      </p>

      {!admins && !isError && <ListSkeleton rows={3} />}
      {!admins && isError && (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-body">{t('errors.generic')}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {t('errors.retry')}
          </Button>
        </div>
      )}
      {admins && (
        <Card className="gap-0 py-2">
          <ul>
            {admins.map((admin) => (
              <AdminRow
                key={admin.id}
                admin={admin}
                isMe={admin.id === me?.id}
                onRemoved={() => setAdded(null)}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function AddAdminForm({
  onCancel,
  onAdded,
}: {
  onCancel: () => void;
  onAdded: (name: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: addAdmin,
    onSuccess: async (admin) => {
      await queryClient.invalidateQueries({ queryKey: adminsQuery.queryKey });
      void queryClient.invalidateQueries({ queryKey: ['groups'] }); // group people lists
      onAdded(admin.name);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'email_taken_admin') {
        setEmailError(t('admins.errors.emailTakenAdmin'));
      } else if (error instanceof ApiError && error.code === 'email_taken_client') {
        setEmailError(t('admins.errors.emailTakenClient'));
      } else {
        setFormError(t('errors.generic'));
      }
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (add.isPending) return;
    setNameError(null);
    setEmailError(null);
    setFormError(null);
    const parsed = AddAdminBodySchema.safeParse({ name, email });
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      if (fields.has('name')) setNameError(t('admins.errors.nameRequired'));
      if (fields.has('email')) setEmailError(t('login.errors.invalidEmail'));
      document.getElementById(fields.has('name') ? 'admin-name' : 'admin-email')?.focus();
      return;
    }
    add.mutate(parsed.data);
  }

  return (
    <Card className="p-5">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2.5">
          <Label htmlFor="admin-name">{t('admins.name')}</Label>
          <Input
            id="admin-name"
            autoComplete="off"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'admin-name-error' : undefined}
          />
          {nameError && (
            <p id="admin-name-error" className="-mt-0.5 text-micro text-error-ink">
              {nameError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          <Label htmlFor="admin-email">{t('admins.email')}</Label>
          <Input
            id="admin-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? 'admin-email-error' : undefined}
          />
          {emailError && (
            <p id="admin-email-error" className="-mt-0.5 text-micro text-error-ink">
              {emailError}
            </p>
          )}
        </div>
        {formError && (
          <p role="alert" className="text-micro text-error-ink">
            {formError}
          </p>
        )}
        <div className="flex flex-col gap-2 min-[641px]:flex-row">
          <Button type="submit" disabled={add.isPending}>
            {t('admins.submit')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('admins.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AdminRow({
  admin,
  isMe,
  onRemoved,
}: {
  admin: Admin;
  isMe: boolean;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);

  // Keep keyboard focus on the row's action: the confirmation button, then back to Remove.
  useEffect(() => {
    if (!toggled.current) return;
    (confirming ? confirmRef : removeRef).current?.focus();
  }, [confirming]);

  const remove = useMutation({
    mutationFn: () => removeAdmin(admin.id),
    onSuccess: async () => {
      onRemoved();
      await queryClient.invalidateQueries({ queryKey: adminsQuery.queryKey });
      void queryClient.invalidateQueries({ queryKey: ['groups'] }); // group people lists
    },
    onError: () => setFailed(true),
  });

  const canRemove = admin.role !== 'superadmin' && !isMe;

  return (
    <li className="flex flex-col gap-3 px-5 py-3 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border">
      {confirming ? (
        <>
          <p className="text-button">{t('admins.confirmRemove', { name: admin.name })}</p>
          <div className="flex gap-2">
            <Button
              ref={confirmRef}
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => {
                setFailed(false);
                remove.mutate();
              }}
            >
              {t('admins.remove')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                toggled.current = true;
                setConfirming(false);
                setFailed(false);
              }}
            >
              {t('admins.cancel')}
            </Button>
          </div>
          {failed && (
            <p role="alert" className="text-micro text-error-ink">
              {t('errors.generic')}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{admin.name}</span>
              {admin.role === 'superadmin' && (
                <Badge variant="secondary">{t('admins.badge.superadmin')}</Badge>
              )}
              {isMe && <Badge variant="outline">{t('admins.badge.you')}</Badge>}
            </div>
            <div className="truncate text-button text-muted-foreground">{admin.email}</div>
          </div>
          {canRemove && (
            <Button
              ref={removeRef}
              variant="ghost"
              size="sm"
              onClick={() => {
                toggled.current = true;
                setConfirming(true);
              }}
            >
              {t('admins.remove')}
            </Button>
          )}
        </>
      )}
    </li>
  );
}
