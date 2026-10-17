import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BULK_LIMITS,
  BulkColumnRatios,
  BulkImageShapes,
  BulkLineColors,
  BulkSpacerSizes,
  BulkVAligns,
  type BulkAlign,
  type BulkBlock,
  type BulkImageWidth,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { resizeImageWithSize } from '@/lib/resize-image';
import { uploadImage } from './api';
import { FieldNote } from './parts';
import { RichTextEditor } from './rich-text-editor';
import type { FieldProblem } from './validation';

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
        <option value="right">{t('bulkEmail.fields.right')}</option>
      </Select>
    </div>
  );
}

/** A labelled select of fixed options (`label(value)` gives each option's text). */
function ChoiceField<V extends string>({
  id,
  label,
  value,
  options,
  optionLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: V;
  options: readonly V[];
  optionLabel: (value: V) => string;
  onChange: (value: V) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        containerClassName="w-full min-[641px]:w-[220px]"
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {optionLabel(o)}
          </option>
        ))}
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
          <RichTextEditor
            id={aria.id}
            value={block.content}
            align={block.align}
            invalid={aria['aria-invalid']}
            describedBy={aria['aria-describedby']}
            onChange={(content) => onChange({ ...block, content })}
          />
        )}
      </Field>
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
              const rest = omit(block, 'href');
              onChange({ ...rest, ...(e.target.value ? { href: e.target.value } : {}) });
            }}
          />
        )}
      </Field>
      <ImageLook block={block} onChange={onChange} />
    </>
  );
}

type ImageBlock = Extract<BulkBlock, { type: 'image' }>;

/** The image block without one of its optional fields. */
function omit(block: ImageBlock, key: 'href' | 'width' | 'shape'): ImageBlock {
  const copy = { ...block };
  delete copy[key];
  return copy;
}
type SizeMode = 'original' | BulkImageWidth['unit'];

/** Size, alignment and shape of an image (Phase 30). */
function ImageLook({ block, onChange }: { block: ImageBlock; onChange: (b: BulkBlock) => void }) {
  const { t } = useTranslation();
  const mode: SizeMode = block.width?.unit ?? 'original';
  const limits = mode === 'px' ? BULK_LIMITS.imagePx : BULK_LIMITS.imagePercent;
  // Typed freely, saved when within the limits (an empty or partial number is not saved yet).
  const [typed, setTyped] = useState(String(block.width?.value ?? ''));
  const setWidth = (width: BulkImageWidth | undefined) => {
    const rest = omit(block, 'width');
    onChange(width ? { ...rest, width } : rest);
  };
  const bad =
    typed !== '' &&
    mode !== 'original' &&
    (Number(typed) < limits.min || Number(typed) > limits.max || !Number.isInteger(Number(typed)));
  return (
    <div className="grid gap-4 min-[641px]:grid-cols-2">
      <ChoiceField<SizeMode>
        id={`b-${block.id}-size`}
        label={t('bulkEmail.image.size')}
        value={mode}
        options={['original', 'percent', 'px']}
        optionLabel={(o) => t(`bulkEmail.image.sizes.${o}`)}
        onChange={(next) => {
          if (next === 'original') return setWidth(undefined);
          const value = next === 'px' ? BULK_LIMITS.imagePx.max : 100;
          setTyped(String(value));
          setWidth({ unit: next, value });
        }}
      />
      {mode !== 'original' && (
        <Field
          id={`b-${block.id}-width`}
          label={t(mode === 'px' ? 'bulkEmail.image.widthPx' : 'bulkEmail.image.widthPercent')}
          hint={t('bulkEmail.image.widthHint', limits)}
          problem={bad ? t('bulkEmail.image.widthHint', limits) : undefined}
        >
          {(aria) => (
            <Input
              {...aria}
              inputMode="numeric"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= limits.min && n <= limits.max && block.width) {
                  setWidth({ unit: block.width.unit, value: n });
                }
              }}
            />
          )}
        </Field>
      )}
      <ChoiceField<BulkAlign>
        id={`b-${block.id}-align`}
        label={t('bulkEmail.fields.align')}
        value={block.align ?? 'center'}
        options={['left', 'center', 'right']}
        optionLabel={(o) => t(`bulkEmail.fields.${o}`)}
        onChange={(align) => onChange({ ...block, align })}
      />
      <div className="flex flex-col gap-2">
        <ChoiceField
          id={`b-${block.id}-shape`}
          label={t('bulkEmail.image.shape')}
          value={block.shape ?? 'square'}
          options={BulkImageShapes}
          optionLabel={(o) => t(`bulkEmail.image.shapes.${o}`)}
          onChange={(shape) => {
            const rest = omit(block, 'shape');
            onChange(shape === 'square' ? rest : { ...rest, shape });
          }}
        />
        {block.shape === 'circle' && <FieldNote>{t('bulkEmail.image.circleHint')}</FieldNote>}
      </div>
    </div>
  );
}

function SpacerForm({ block, onChange }: FormProps<Extract<BulkBlock, { type: 'spacer' }>>) {
  const { t } = useTranslation();
  return (
    <ChoiceField
      id={`b-${block.id}-spacer`}
      label={t('bulkEmail.spacer.size')}
      value={block.size}
      options={BulkSpacerSizes}
      optionLabel={(o) => t(`bulkEmail.spacer.sizes.${o}`)}
      onChange={(size) => onChange({ ...block, size })}
    />
  );
}

/** The split container's own settings; its two sides are block lists (`block-list.tsx`). */
export function ColumnsSettings({
  block,
  onChange,
}: {
  block: Extract<BulkBlock, { type: 'columns' }>;
  onChange: (b: BulkBlock) => void;
}) {
  const { t } = useTranslation();
  const dividerId = `b-${block.id}-divider`;
  return (
    <div className="grid gap-4 min-[641px]:grid-cols-2">
      <ChoiceField
        id={`b-${block.id}-ratio`}
        label={t('bulkEmail.columns.ratio')}
        value={block.ratio}
        options={BulkColumnRatios}
        optionLabel={(o) => t(`bulkEmail.columns.ratios.${o}`)}
        onChange={(ratio) => onChange({ ...block, ratio })}
      />
      <ChoiceField
        id={`b-${block.id}-valign`}
        label={t('bulkEmail.columns.valign')}
        value={block.valign}
        options={BulkVAligns}
        optionLabel={(o) => t(`bulkEmail.columns.valigns.${o}`)}
        onChange={(valign) => onChange({ ...block, valign })}
      />
      <label
        htmlFor={dividerId}
        className="flex min-h-11 items-center gap-3 text-button font-medium"
      >
        <input
          id={dividerId}
          type="checkbox"
          className="size-5 accent-foreground"
          checked={block.divider}
          onChange={(e) => onChange({ ...block, divider: e.target.checked })}
        />
        {t('bulkEmail.columns.divider')}
      </label>
      {block.divider && (
        <ChoiceField
          id={`b-${block.id}-divider-color`}
          label={t('bulkEmail.columns.dividerColor')}
          value={block.dividerColor}
          options={BulkLineColors}
          optionLabel={(o) => t(`bulkEmail.colors.${o}`)}
          onChange={(dividerColor) => onChange({ ...block, dividerColor })}
        />
      )}
    </div>
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

/** The edit form of one block; a divider has nothing to edit. A container's sides are in `BlockList`. */
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
    case 'spacer':
      return <SpacerForm {...props} block={block} />;
    case 'columns':
      return <ColumnsSettings block={block} onChange={props.onChange} />;
    case 'divider':
      return (
        <p className="text-micro text-muted-foreground">{t('bulkEmail.fields.dividerNote')}</p>
      );
  }
}
