import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BULK_LIMITS, type BulkAlign, type BulkBlock } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { resizeImageWithSize } from '@/lib/resize-image';
import { uploadImage } from './api';
import { FieldNote } from './parts';
import type { FieldProblem } from './validation';

export const TEXTAREA =
  'min-h-[132px] w-full resize-y rounded-md border-2 border-input bg-card px-[18px] py-[13px] text-button font-medium text-foreground transition-colors duration-(--duration-fast) placeholder:text-muted-foreground focus:border-foreground aria-invalid:border-destructive';

type FormProps<B extends BulkBlock> = {
  block: B;
  problems: Record<string, FieldProblem> | undefined;
  onChange: (block: BulkBlock) => void;
};

/** One labelled field with its hint or problem. `control` gets the id and aria props. */
function Field({
  id,
  label,
  hint,
  problem,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  problem?: string;
  children: (aria: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}) {
  const noteId = `${id}-note`;
  const note = problem ?? hint;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        ...(problem ? { 'aria-invalid': true as const } : {}),
        ...(note ? { 'aria-describedby': noteId } : {}),
      })}
      {note && (
        <FieldNote id={noteId} error={Boolean(problem)}>
          {note}
        </FieldNote>
      )}
    </div>
  );
}

function useProblemText() {
  const { t } = useTranslation();
  return (problem: FieldProblem | undefined, max?: number) =>
    problem ? t(`bulkEmail.problems.${problem}`, { max }) : undefined;
}

function AlignField({
  block,
  onChange,
}: {
  block: Extract<BulkBlock, { align: BulkAlign }>;
  onChange: (b: BulkBlock) => void;
}) {
  const { t } = useTranslation();
  const id = `b-${block.id}-align`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t('bulkEmail.fields.align')}</Label>
      <Select
        id={id}
        containerClassName="w-full min-[641px]:w-[200px]"
        value={block.align}
        onChange={(e) => onChange({ ...block, align: e.target.value as BulkAlign } as BulkBlock)}
      >
        <option value="left">{t('bulkEmail.fields.left')}</option>
        <option value="center">{t('bulkEmail.fields.center')}</option>
      </Select>
    </div>
  );
}

function HeadingForm({
  block,
  problems,
  onChange,
}: FormProps<Extract<BulkBlock, { type: 'heading' }>>) {
  const { t } = useTranslation();
  const problem = useProblemText();
  return (
    <>
      <Field
        id={`b-${block.id}-text`}
        label={t('bulkEmail.fields.text')}
        hint={t('bulkEmail.fields.nameHint', { placeholder: '{{name}}' })}
        problem={problem(problems?.text, BULK_LIMITS.heading)}
      >
        {(aria) => (
          <Input
            {...aria}
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
          />
        )}
      </Field>
      <AlignField block={block} onChange={onChange} />
    </>
  );
}

function TextForm({ block, problems, onChange }: FormProps<Extract<BulkBlock, { type: 'text' }>>) {
  const { t } = useTranslation();
  const problem = useProblemText();
  return (
    <>
      <Field
        id={`b-${block.id}-text`}
        label={t('bulkEmail.fields.text')}
        hint={t('bulkEmail.fields.textHint', { placeholder: '{{name}}' })}
        problem={problem(problems?.text, BULK_LIMITS.text)}
      >
        {(aria) => (
          <textarea
            {...aria}
            className={TEXTAREA}
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
          />
        )}
      </Field>
      <AlignField block={block} onChange={onChange} />
    </>
  );
}

function ImageForm({
  block,
  problems,
  onChange,
}: FormProps<Extract<BulkBlock, { type: 'image' }>>) {
  const { t } = useTranslation();
  const problem = useProblemText();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  // The block as it is when the upload ends: the alt text may have been typed meanwhile.
  const latest = useRef(block);
  useEffect(() => {
    latest.current = block;
  });

  async function upload(file: File) {
    setUploading(true);
    setFailed(false);
    try {
      // Mail apps rarely show WebP: a PNG stays PNG (sharp edges, transparency), the rest is JPEG.
      const { blob } = await resizeImageWithSize(file, BULK_LIMITS.imageWidth, {
        outputType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
        fit: 'width',
      });
      const image = await uploadImage(blob);
      onChange({ ...latest.current, imageId: image.id });
    } catch {
      setFailed(true);
    } finally {
      setUploading(false);
    }
  }

  const imageProblem = problems?.imageId ? t('bulkEmail.problems.imageMissing') : undefined;
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-tiny font-semibold">{t('bulkEmail.fields.image')}</span>
        {block.imageId && (
          <img
            src={`/api/bulk-email/images/${encodeURIComponent(block.imageId)}`}
            alt=""
            className="max-h-[200px] w-auto max-w-full self-start rounded-md bg-muted object-contain"
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-label={t('bulkEmail.fields.upload')}
          data-testid={`b-${block.id}-file`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading
            ? t('bulkEmail.fields.uploading')
            : t(block.imageId ? 'bulkEmail.fields.replace' : 'bulkEmail.fields.upload')}
        </Button>
        {failed ? (
          <FieldNote error>{t('bulkEmail.fields.uploadFailed')}</FieldNote>
        ) : (
          imageProblem && <FieldNote error>{imageProblem}</FieldNote>
        )}
      </div>
      <Field
        id={`b-${block.id}-alt`}
        label={t('bulkEmail.fields.alt')}
        hint={t('bulkEmail.fields.altHint')}
        problem={problem(problems?.alt, BULK_LIMITS.alt)}
      >
        {(aria) => (
          <Input
            {...aria}
            value={block.alt}
            onChange={(e) => onChange({ ...block, alt: e.target.value })}
          />
        )}
      </Field>
      <Field
        id={`b-${block.id}-href`}
        label={t('bulkEmail.fields.href')}
        problem={problem(problems?.href)}
      >
        {(aria) => (
          <Input
            {...aria}
            inputMode="url"
            placeholder="https://"
            value={block.href ?? ''}
            onChange={(e) => {
              const { id, type, imageId, alt } = block;
              onChange({
                id,
                type,
                imageId,
                alt,
                ...(e.target.value ? { href: e.target.value } : {}),
              });
            }}
          />
        )}
      </Field>
    </>
  );
}

function ButtonForm({
  block,
  problems,
  onChange,
}: FormProps<Extract<BulkBlock, { type: 'button' }>>) {
  const { t } = useTranslation();
  const problem = useProblemText();
  return (
    <>
      <Field
        id={`b-${block.id}-label`}
        label={t('bulkEmail.fields.label')}
        problem={problem(problems?.label, BULK_LIMITS.buttonLabel)}
      >
        {(aria) => (
          <Input
            {...aria}
            value={block.label}
            onChange={(e) => onChange({ ...block, label: e.target.value })}
          />
        )}
      </Field>
      <Field
        id={`b-${block.id}-url`}
        label={t('bulkEmail.fields.url')}
        hint={t('bulkEmail.fields.urlHint')}
        problem={problem(problems?.url)}
      >
        {(aria) => (
          <Input
            {...aria}
            inputMode="url"
            placeholder="https://"
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
          />
        )}
      </Field>
      <AlignField block={block} onChange={onChange} />
    </>
  );
}

/** The edit form of one block; a divider has nothing to edit. */
export function BlockForm(props: FormProps<BulkBlock>) {
  const { t } = useTranslation();
  const { block } = props;
  switch (block.type) {
    case 'heading':
      return <HeadingForm {...props} block={block} />;
    case 'text':
      return <TextForm {...props} block={block} />;
    case 'image':
      return <ImageForm {...props} block={block} />;
    case 'button':
      return <ButtonForm {...props} block={block} />;
    case 'logo':
      return <AlignField block={block} onChange={props.onChange} />;
    case 'divider':
      return (
        <p className="text-micro text-muted-foreground">{t('bulkEmail.fields.dividerNote')}</p>
      );
  }
}
