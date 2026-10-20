import { z } from 'zod';
import {
  AddRateBodySchema,
  FinanceFolderBodySchema,
  FinanceFolderPatchSchema,
  FinanceItemBodySchema,
  FinanceItemPatchSchema,
  FinanceItemTypes,
  FinanceOrgItemBodySchema,
  PutMyTaskTimeBodySchema,
  PutMyTicketTimeBodySchema,
  SalaryBodySchema,
  SalaryPatchSchema,
  SystemManualEntryBodySchema,
  TimeEntryPatchSchema,
} from '@spolu/shared';
import {
  cursorArg,
  defineTool,
  fromApi,
  idArg,
  idOf,
  patchVersioned,
  query,
  type ToolDef,
} from './define.js';

/**
 * Finance through MCP (owner decision of 2026-10-18, replacing "documents only"): every finance
 * entity of the HTTP API, read and write, mirroring its routes: a client's items and the
 * organisation's (contracts of several clients with their shares, expenses), the admins' salaries
 * and the documents linked to salaries and expenses (2026-10-21), the overviews,
 * work logs, time entries, rates, the contracts table and the rankings. Every tool here is `finance`, so
 * only finance holders (`canSeeFinance`) see or call it; the routes check `requireFinance` and
 * their own policies again. Not exposed: deletes (no MCP tool deletes anything), uploads and
 * granting the finance right.
 */

const month = z.string().max(7).optional().describe('A month "YYYY-MM"');
const period = {
  from: month.describe('First month "YYYY-MM" (with `to`; both absent: all time)'),
  to: month.describe('Last month "YYYY-MM"'),
};
const clients = z
  .string()
  .max(20_000)
  .optional()
  .describe('Comma-separated client group ids; absent: every client');

const finance = { finance: true } as const;

export const financeTools: ToolDef[] = [
  // Documents, contracts and notes of a client, in folders
  defineTool({
    ...finance,
    name: 'list_finance_documents',
    title: 'List finance documents',
    description:
      'Finance items of a client (`groupId`: its contracts with its own share of a contract of several clients, documents and notes) or, without `groupId`, of the organisation (contracts of several clients with every share, expenses, documents and notes without a client; admins’ salaries are list_salaries). Newest first, 30 a page. Without `type` and `q` the open `folder` (a folder id, default the top level); a `type` ("contract", "document", "note", "expense") or a search `q` lists every folder. Paged with `after` from `nextCursor`.',
    input: z.object({
      groupId: idArg('group').optional(),
      folder: z.string().max(64).optional(),
      type: z.enum(FinanceItemTypes).optional(),
      q: z.string().max(100).optional(),
      after: cursorArg,
    }),
    run: async ({ api }, { groupId, ...rest }) =>
      fromApi(
        await api(
          'GET',
          groupId ? `/api/groups/${groupId}/finance/items` : '/api/finance/org/items',
          { query: query(rest) },
        ),
      ),
  }),
  defineTool({
    ...finance,
    name: 'list_finance_document_folders',
    title: 'List finance folders',
    description:
      'The folders of a client’s finance items (`groupId`) or, without it, of the organisation’s (a tree by parentId).',
    input: z.object({ groupId: idArg('group').optional() }),
    run: async ({ api }, { groupId }) =>
      fromApi(
        await api(
          'GET',
          groupId ? `/api/groups/${groupId}/finance/folders` : '/api/finance/org/folders',
        ),
      ),
  }),
  defineTool({
    ...finance,
    name: 'get_finance_document',
    title: 'Get a finance document',
    description:
      'One finance item (contract, document, note or expense) with its text and files (read_file gives a file’s content): a contract’s number, amount, period and, for a contract of several clients, its payer and every share, plus its master (`parent`), the contracts under it (`children`), its payment `schedule` with the expected `payments` and its linked `documents`; an expense’s amount, date and linked documents (`costDocuments`); a document’s linked salaries and expenses (`linkedCosts`) and its contract (`contractLink`). With `groupId` the item as that client’s tab shows it (only its own share).',
    input: z.object({ itemId: idArg('finance item'), groupId: idArg('group').optional() }),
    run: async ({ api }, { itemId, groupId }) =>
      fromApi(
        await api('GET', `/api/finance/items/${itemId}`, { query: query({ group: groupId }) }),
      ),
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'create_finance_document',
    title: 'Create a finance document',
    description:
      'Creates a contract (`type` "contract" with `amount` { amountMinor (cents, 0 allowed), currency "EUR" }, `startsOn`, `endsOn`, optional `contractNumber`, optional `parentId` (a master contract from list_contract_choices: one level only, covering this client) and optional `schedule` (see get_contract_payments)), a "document" (optional `contractLink` { contractId, payment: { amount, paidOn } | null }) or a "note" of a client, optionally in `folderId`.',
    input: z.object({ groupId: idArg('group'), item: FinanceItemBodySchema }),
    target: ({ groupId }) => groupId,
    run: async ({ api }, { groupId }, raw) => {
      const res = await api('POST', `/api/groups/${groupId}/finance/items`, { body: raw.item });
      return { ...fromApi(res), targetId: idOf(res.body, groupId) };
    },
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'create_organisation_finance_item',
    title: 'Create an organisation finance item',
    description:
      'Creates an item of the organisation (on /finance, no single client): a contract of several clients (a payer, the whole `amount` and 2–50 `shares` { groupId, amountMinor } that add up to it, 0 allowed; optional `parentId` and `schedule` as for create_finance_document), an expense (a payment of the organisation, its `title` saying what for; an admin’s salary is create_salary), or a document (optional `contractLink` to a contract of several clients) or note without a client.',
    input: z.object({ item: FinanceOrgItemBodySchema }),
    run: async ({ api }, _args, raw) => {
      const res = await api('POST', '/api/finance/org/items', { body: raw.item });
      return { ...fromApi(res), targetId: idOf(res.body, null) };
    },
  }),
  defineTool({
    ...finance,
    name: 'list_finance_payees',
    title: 'List salary payees',
    description: 'Who a salary (create_salary) may pay: the active admins and the superadmin.',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/finance/payees')),
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'link_finance_document',
    title: 'Link a finance document',
    description:
      'Links a finance document (an item of type "document", `documentId`) to an admin’s salary (`salaryId`) or to an expense (`expenseId`), exactly one of them. Linking twice changes nothing.',
    input: z
      .object({
        documentId: idArg('finance document'),
        salaryId: idArg('salary').optional(),
        expenseId: idArg('expense').optional(),
      })
      .refine((v) => (v.salaryId === undefined) !== (v.expenseId === undefined), {
        message: 'exactly one of salaryId and expenseId',
      }),
    target: ({ salaryId, expenseId }) => salaryId ?? expenseId ?? null,
    run: async ({ api }, { documentId, salaryId, expenseId }) =>
      fromApi(
        await api(
          'POST',
          salaryId
            ? `/api/finance/salaries/${salaryId}/documents`
            : `/api/finance/expenses/${expenseId}/documents`,
          { body: { documentId } },
        ),
      ),
  }),

  // Salaries (2026-10-21): what the organisation paid an admin for a month
  defineTool({
    ...finance,
    name: 'list_salaries',
    title: 'List salaries',
    description:
      'The admins’ salaries, newest month first, 50 a page with `after` from `nextCursor`: of one admin (`admin`, a user id) or every admin, in a month range (`from`/`to` "YYYY-MM", both or neither). The first page carries `totals`: per currency, per admin and per month (amounts in cents).',
    input: z.object({
      admin: idArg('admin').optional(),
      ...period,
      after: z.string().min(1).max(200).optional(),
    }),
    run: async ({ api }, args) =>
      fromApi(await api('GET', '/api/finance/salaries', { query: query(args) })),
  }),
  defineTool({
    ...finance,
    name: 'get_salary',
    title: 'Get a salary',
    description:
      'One salary: its admin, month, amount (cents), note, files (read_file gives a file’s content) and linked documents.',
    input: z.object({ salaryId: idArg('salary') }),
    run: async ({ api }, { salaryId }) =>
      fromApi(await api('GET', `/api/finance/salaries/${salaryId}`)),
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'create_salary',
    title: 'Record a salary',
    description:
      'Records what the organisation paid an admin (`payeeId` from list_finance_payees) for a `month` "YYYY-MM": `amount` { amountMinor (cents, 0 or more), currency "EUR" }, an optional `note`.',
    input: z.object({ salary: SalaryBodySchema }),
    run: async ({ api }, _args, raw) => {
      const res = await api('POST', '/api/finance/salaries', { body: raw.salary });
      return { ...fromApi(res), targetId: idOf(res.body, null) };
    },
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'update_salary',
    title: 'Update a salary',
    description:
      'Changes a salary’s `payeeId`, `month`, `amount` or `note`. Pass the `updatedAt` you read to refuse a stale edit (409 finance_changed); without it the current version is used.',
    input: z.object({
      salaryId: idArg('salary'),
      changes: SalaryPatchSchema.partial({ updatedAt: true }),
    }),
    target: ({ salaryId }) => salaryId,
    run: async ({ api }, { salaryId }, raw) =>
      patchVersioned(
        api,
        `/api/finance/salaries/${salaryId}`,
        raw.changes as Record<string, unknown>,
      ),
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'update_finance_document',
    title: 'Update a finance document',
    description:
      'Changes the fields named in `changes` (title, body, folderId; on a contract contractNumber, amount (0 allowed), startsOn, endsOn, `parentId` (a master, or null; 400 invalid_parent when the one-level or client rule refuses it), `schedule` (or null for none; 400 invalid_schedule when it yields no payment); on an expense amount and spentOn; on a document `contractLink` (or null)). Pass the `updatedAt` you read to refuse a stale edit (409 finance_changed); without it the current version is used.',
    input: z.object({
      itemId: idArg('finance item'),
      changes: FinanceItemPatchSchema.partial({ updatedAt: true }),
    }),
    target: ({ itemId }) => itemId,
    run: async ({ api }, { itemId }, raw) =>
      patchVersioned(api, `/api/finance/items/${itemId}`, raw.changes as Record<string, unknown>),
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'create_finance_folder',
    title: 'Create a finance folder',
    description:
      'Creates a folder of a client’s finance items (`groupId`) or, without it, of the organisation’s (`parentId` null: top level).',
    input: z.object({ groupId: idArg('group').optional(), folder: FinanceFolderBodySchema }),
    target: ({ groupId }) => groupId ?? null,
    run: async ({ api }, { groupId }, raw) => {
      const res = await api(
        'POST',
        groupId ? `/api/groups/${groupId}/finance/folders` : '/api/finance/org/folders',
        { body: raw.folder },
      );
      return { ...fromApi(res), targetId: idOf(res.body, groupId ?? null) };
    },
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'update_finance_folder',
    title: 'Rename or move a finance folder',
    description: 'Renames (`name`) and/or moves (`parentId`) a finance folder.',
    input: z.object({ folderId: idArg('folder'), changes: FinanceFolderPatchSchema }),
    target: ({ folderId }) => folderId,
    run: async ({ api }, { folderId }, raw) =>
      fromApi(await api('PATCH', `/api/finance/folders/${folderId}`, { body: raw.changes })),
  }),

  // Overview and work log
  defineTool({
    ...finance,
    name: 'get_finance_overview',
    title: 'Get a finance overview',
    description:
      'Money and hours by month: of one client (`groupId`) or across clients (`clients`, default all, which then includes time without a client). Contracts paid and to be paid, the cost of the work (hours × rates), per admin hours.',
    input: z.object({ groupId: idArg('group').optional(), clients, ...period }),
    run: async ({ api }, { groupId, clients: list, ...rest }) =>
      fromApi(
        groupId
          ? await api('GET', `/api/groups/${groupId}/finance/overview`, { query: query(rest) })
          : await api('GET', '/api/finance/overview', {
              query: query({ ...rest, clients: list }),
            }),
      ),
  }),
  defineTool({
    ...finance,
    name: 'get_work_log',
    title: 'Get the work log',
    description:
      'The time entries (task, ticket and manual time, waiting requests) with their totals, oldest first: of one client (`groupId`) or across clients (`clients`). The latest 200 entries; earlier ones with `before` from the answer.',
    input: z.object({
      groupId: idArg('group').optional(),
      clients,
      ...period,
      before: z.string().min(1).max(200).optional(),
    }),
    run: async ({ api }, { groupId, clients: list, ...rest }) =>
      fromApi(
        groupId
          ? await api('GET', `/api/groups/${groupId}/finance/work-log`, { query: query(rest) })
          : await api('GET', '/api/finance/work-log', {
              query: query({ ...rest, clients: list }),
            }),
      ),
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'add_time_entry',
    title: 'Add a manual time entry',
    description:
      'Adds time an admin (`userId`) spent on a day (`workedOn` "YYYY-MM-DD", not in the future), `minutes` (0–6000) and a `note`, for a client (`groupId`) or without one (`groupId` null).',
    input: z.object({ entry: SystemManualEntryBodySchema }),
    run: async ({ api }, _args, raw) => {
      const res = await api('POST', '/api/finance/time-entries', { body: raw.entry });
      return { ...fromApi(res), targetId: idOf(res.body, null) };
    },
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'update_time_entry',
    title: 'Update a time entry',
    description:
      'Changes a time entry: a manual one its `minutes`, `workedOn` and `note`; a task or ticket entry its `minutes` only (0 resets it).',
    input: z.object({ entryId: idArg('time entry'), changes: TimeEntryPatchSchema }),
    target: ({ entryId }) => entryId,
    run: async ({ api }, { entryId }, raw) =>
      fromApi(await api('PATCH', `/api/finance/time-entries/${entryId}`, { body: raw.changes })),
  }),

  // Rates
  defineTool({
    ...finance,
    name: 'list_rates',
    title: 'List hourly rates',
    description: 'Every admin with the hourly rate that applies today and its history (EUR cents).',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/finance/rates')),
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'add_rate',
    title: 'Set an hourly rate',
    description:
      'Sets an admin’s hourly rate (`rateMinor`, EUR cents) from a day (`effectiveFrom` "YYYY-MM-DD", or null: from the start); a rate for a day that already has one corrects it.',
    input: z.object({ rate: AddRateBodySchema }),
    run: async ({ api }, _args, raw) => {
      const res = await api('POST', '/api/finance/rates', { body: raw.rate });
      return { ...fromApi(res), targetId: idOf(res.body, null) };
    },
  }),

  // Contracts v2 (ADR 0066): masters, schedules, expected payments, linked documents, files
  defineTool({
    ...finance,
    name: 'get_contract',
    title: 'Get a contract',
    description:
      'One contract with its master (`parent`), the contracts under it (`children`; a master is one level only), its payment `schedule`, the expected `payments` against what its linked documents received (each period paid, partial, unpaid or upcoming), its linked `documents` and its `files`. With `groupId` as that client’s tab shows it (its share of a contract of several clients, its own contracts and documents only).',
    input: z.object({ contractId: idArg('contract'), groupId: idArg('group').optional() }),
    run: async ({ api }, { contractId, groupId }) => {
      const res = await api('GET', `/api/finance/items/${contractId}`, {
        query: query({ group: groupId }),
      });
      if (res.status === 200 && (res.body as { type?: string } | null)?.type !== 'contract') {
        return { status: 404, data: { error: 'not_found' } };
      }
      return fromApi(res);
    },
  }),
  defineTool({
    ...finance,
    name: 'get_contract_payments',
    title: 'Get a contract’s expected payments',
    description:
      'A contract’s payment schedule (`frequency` monthly, quarterly, semiannual, yearly, everyMonths with `everyMonths`, or dates with `dates`; amount per period; start and optional end, else the contract’s end) and its periods: due day, expected, received (the payments its linked documents record, dated from the due day to the next one; the last period stays open) and status. Nothing is created from a schedule. `schedule` null: the contract has none.',
    input: z.object({ contractId: idArg('contract'), groupId: idArg('group').optional() }),
    run: async ({ api }, { contractId, groupId }) =>
      fromApi(
        await api('GET', `/api/finance/items/${contractId}`, { query: query({ group: groupId }) }),
        (body) => {
          const b = body as Record<string, unknown>;
          return {
            id: b.id,
            title: b.title,
            schedule: b.schedule ?? null,
            payments: b.payments ?? null,
          };
        },
      ),
  }),
  defineTool({
    ...finance,
    name: 'list_contract_attachments',
    title: 'List a contract’s files and documents',
    description:
      'The files attached to a contract (read_file gives a file’s content) and the finance documents linked to it, each with the payment it records.',
    input: z.object({ contractId: idArg('contract'), groupId: idArg('group').optional() }),
    run: async ({ api }, { contractId, groupId }) =>
      fromApi(
        await api('GET', `/api/finance/items/${contractId}`, { query: query({ group: groupId }) }),
        (body) => {
          const b = body as Record<string, unknown>;
          return { id: b.id, title: b.title, files: b.files ?? [], documents: b.documents ?? [] };
        },
      ),
  }),
  defineTool({
    ...finance,
    name: 'list_contract_choices',
    title: 'List contracts to link or nest',
    description:
      'The contracts a master or a document’s contract may be: a client’s own and those it has a share of (`groupId`), or without it the organisation’s contracts of several clients. Each says whether it has a master (`parentId`, so it cannot be a master) or contracts under it (`hasChildren`, so it cannot get a master).',
    input: z.object({ groupId: idArg('group').optional() }),
    run: async ({ api }, { groupId }) =>
      fromApi(
        await api('GET', '/api/finance/contract-choices', { query: query({ group: groupId }) }),
      ),
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'link_finance_document_to_contract',
    title: 'Link a finance document to a contract',
    description:
      'Links a finance document to a contract of its client (or, for the organisation’s document or a client’s, to a contract of several clients that includes it), optionally recording the `payment` it is for ({ amount: { amountMinor, currency "EUR" }, paidOn "YYYY-MM-DD" }), which counts towards the contract’s schedule. `contractId` null unlinks it. Pass `updatedAt` to refuse a stale edit.',
    input: z.object({
      documentId: idArg('finance document'),
      contractId: idArg('contract').nullable(),
      payment: z
        .object({
          amount: z.object({ amountMinor: z.number().int().min(0), currency: z.string() }),
          paidOn: z.string(),
        })
        .nullable()
        .optional(),
      updatedAt: z.string().optional(),
    }),
    target: ({ documentId }) => documentId,
    run: async ({ api }, { documentId, contractId, payment, updatedAt }) =>
      patchVersioned(api, `/api/finance/items/${documentId}`, {
        ...(updatedAt ? { updatedAt } : {}),
        contractLink: contractId === null ? null : { contractId, payment: payment ?? null },
      }),
  }),

  // System-wide: contracts table and rankings
  defineTool({
    ...finance,
    name: 'list_contracts',
    title: 'List contracts across clients',
    description:
      'The chosen clients’ contracts running in the period (a search `q` covers every contract, document and note), sorted by `sort` "start", "end" or "amount" and `dir`, 30 a page with `after`.',
    input: z.object({
      clients,
      ...period,
      sort: z.enum(['start', 'end', 'amount']).optional(),
      dir: z.enum(['asc', 'desc']).optional(),
      q: z.string().max(100).optional(),
      after: z.string().min(1).max(500).optional(),
    }),
    run: async ({ api }, args) =>
      fromApi(await api('GET', '/api/finance/contracts', { query: query(args) })),
  }),
  defineTool({
    ...finance,
    name: 'get_paid_ranking',
    title: 'Rank clients by money paid',
    description:
      'Clients ranked by the amounts of contracts that started in the period (`from`/`to`, or `year` and optional `month`), one `currency`, 20 a page with `after`.',
    input: z.object({
      clients,
      ...period,
      year: z.number().int().min(2000).max(2100).optional(),
      month: z.number().int().min(1).max(12).optional(),
      currency: z.string().max(3).optional(),
      after: z.string().min(1).max(200).optional(),
    }),
    run: async ({ api }, args) =>
      fromApi(await api('GET', '/api/finance/rankings/paid', { query: query(args) })),
  }),
  defineTool({
    ...finance,
    name: 'get_hours_ranking',
    title: 'Rank clients by hours',
    description:
      'Clients ranked by counted hours (`sort` "hours") or their cost ("cost"), for all admins or one (`admin`), 20 a page with `after`.',
    input: z.object({
      clients,
      ...period,
      admin: z.string().max(64).optional(),
      sort: z.enum(['hours', 'cost']).optional(),
      after: z.string().min(1).max(200).optional(),
    }),
    run: async ({ api }, args) =>
      fromApi(await api('GET', '/api/finance/rankings/hours', { query: query(args) })),
  }),

  // Task and ticket time
  defineTool({
    ...finance,
    name: 'get_task_time',
    title: 'Get a task’s time',
    description: 'The time logged on a task: the user’s own entry and every assignee’s.',
    input: z.object({ taskId: idArg('task') }),
    run: async ({ api }, { taskId }) => fromApi(await api('GET', `/api/tasks/${taskId}/time`)),
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'set_my_task_time',
    title: 'Log my time on a task',
    description: 'Sets the user’s own minutes on a task they are an assignee of.',
    input: z.object({ taskId: idArg('task'), time: PutMyTaskTimeBodySchema }),
    target: ({ taskId }) => taskId,
    run: async ({ api }, { taskId }, raw) =>
      fromApi(await api('PUT', `/api/tasks/${taskId}/time/me`, { body: raw.time })),
  }),
  defineTool({
    ...finance,
    name: 'get_ticket_time',
    title: 'Get a ticket’s time',
    description:
      'The time logged on a ticket: the user’s own entry, their minutes on its linked tasks, and every riešiteľ’s.',
    input: z.object({ ticketId: idArg('ticket') }),
    run: async ({ api }, { ticketId }) =>
      fromApi(await api('GET', `/api/tickets/${ticketId}/time`)),
  }),
  defineTool({
    ...finance,
    write: true,
    name: 'set_my_ticket_time',
    title: 'Log my time on a ticket',
    description:
      'Sets the user’s own time on a ticket they are a riešiteľ of: `{ minutes }`, or `{ coveredByTasks: true }` when the linked tasks’ hours cover it.',
    input: z.object({ ticketId: idArg('ticket'), time: PutMyTicketTimeBodySchema }),
    target: ({ ticketId }) => ticketId,
    run: async ({ api }, { ticketId }, raw) =>
      fromApi(await api('PUT', `/api/tickets/${ticketId}/time/me`, { body: raw.time })),
  }),
];
