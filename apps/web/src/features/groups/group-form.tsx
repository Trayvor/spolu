import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GroupInputSchema, type Group } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { createGroup, removeLogo, updateGroup, uploadLogo } from './api';
import { GroupLogo } from './group-logo';
import { resizeImage } from './resize-image';

/** A valid http(s) URL; the server stores it normalized. */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

class LogoUploadError extends Error {
  /** True when the file itself is at fault: a broken image (resize failed) or a 400 / 413 answer. */
  readonly badFile: boolean;
  constructor(cause: unknown) {
    super('Logo upload failed');
    this.badFile = !(cause instanceof ApiError) || cause.status === 400 || cause.status === 413;
  }
}

/**
 * Inline create / edit form (no modal). Without `group` it creates one, then uploads the logo:
 * if only the logo fails, the group exists, so the form carries on as the edit form of that
 * group with the logo error shown. Removing the logo takes effect on Save, like every other field.
 */
export function GroupForm({
  group,
  onSaved,
  onCancel,
}: {
  group?: Group;
  onSaved: (group: Group) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState<Group | undefined>(group);
  const [name, setName] = useState(group?.name ?? '');
  const [egrantUrl, setEgrantUrl] = useState(group?.egrantUrl ?? '');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [removing, setRemoving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const preview = useMemo(() => (logoFile ? URL.createObjectURL(logoFile) : null), [logoFile]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const save = useMutation({
    mutationFn: async (input: { name: string; egrantUrl: string }) => {
      const saved = current ? await updateGroup(current.id, input) : await createGroup(input);
      // The group is saved from here on: a later failure must not lose it.
      setCurrent(saved);
      if (logoFile) {
        try {
          await uploadLogo(saved.id, await resizeImage(logoFile));
        } catch (error) {
          throw new LogoUploadError(error);
        }
      } else if (removing && saved.hasLogo) {
        await removeLogo(saved.id);
      }
      return saved;
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      onSaved(saved);
    },
    onError: async (error) => {
      if (error instanceof LogoUploadError) {
        setLogoFile(null);
        if (error.badFile) setLogoError(t('groups.errors.invalidLogo'));
        else setFormError(t('errors.generic'));
        await queryClient.invalidateQueries({ queryKey: ['groups'] });
      } else if (error instanceof ApiError && error.code === 'egrant_url_taken') {
        setUrlError(t('groups.errors.urlTaken'));
      } else {
        // Includes `validation_failed`: the client checks both fields first, so it does not say which.
        setFormError(t('errors.generic'));
      }
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    setNameError(null);
    setUrlError(null);
    setLogoError(null);
    setFormError(null);
    const parsed = GroupInputSchema.safeParse({ name, egrantUrl });
    const nameBad = !parsed.success && parsed.error.issues.some((i) => i.path[0] === 'name');
    const urlBad = !isHttpUrl(egrantUrl);
    if (nameBad) setNameError(t('groups.errors.nameRequired'));
    if (urlBad) setUrlError(t('groups.errors.invalidUrl'));
    if (nameBad || urlBad || !parsed.success) {
      document.getElementById(nameBad ? 'group-name' : 'group-url')?.focus();
      return;
    }
    save.mutate({ name: parsed.data.name, egrantUrl: egrantUrl.trim() });
  }

  const showCurrentLogo = !!current?.hasLogo && !removing && !logoFile;

  return (
    <Card className="p-5">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2.5">
          <Label htmlFor="group-name">{t('groups.form.name')}</Label>
          <Input
            id="group-name"
            autoComplete="off"
            autoFocus
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'group-name-error' : undefined}
          />
          {nameError && (
            <p id="group-name-error" className="-mt-0.5 text-micro text-error-ink">
              {nameError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          <Label htmlFor="group-url">{t('groups.form.egrantUrl')}</Label>
          <Input
            id="group-url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            placeholder="https://firma.egrant.sk"
            value={egrantUrl}
            onChange={(e) => setEgrantUrl(e.target.value)}
            aria-invalid={urlError ? true : undefined}
            aria-describedby={urlError ? 'group-url-error' : undefined}
          />
          {urlError && (
            <p id="group-url-error" className="-mt-0.5 text-micro text-error-ink">
              {urlError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          <Label htmlFor="group-logo">{t('groups.form.logo')}</Label>
          <div className="flex items-center gap-3">
            {preview ? (
              <img
                src={preview}
                alt=""
                width={56}
                height={56}
                className="size-14 shrink-0 rounded-lg object-contain"
              />
            ) : (
              <GroupLogo
                groupId={current?.id}
                name={name}
                hasLogo={showCurrentLogo}
                version={current?.updatedAt}
                size={56}
              />
            )}
            <input
              id="group-logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                setLogoFile(e.target.files?.[0] ?? null);
                setRemoving(false);
                setLogoError(null);
              }}
              aria-invalid={logoError ? true : undefined}
              aria-describedby={logoError ? 'group-logo-error' : undefined}
              className="min-w-0 text-micro text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-micro file:font-semibold file:text-secondary-foreground hover:file:bg-surface-3"
            />
          </div>
          {showCurrentLogo && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="self-start px-0"
              onClick={() => setRemoving(true)}
            >
              {t('groups.form.removeLogo')}
            </Button>
          )}
          {logoError && (
            <p id="group-logo-error" role="alert" className="-mt-0.5 text-micro text-error-ink">
              {logoError}
            </p>
          )}
        </div>
        {formError && (
          <p role="alert" className="text-micro text-error-ink">
            {formError}
          </p>
        )}
        <div className="flex flex-col gap-2 min-[641px]:flex-row">
          <Button type="submit" disabled={save.isPending}>
            {t('groups.form.save')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('groups.form.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
