/** The e2e superadmin's address. scripts/ci.sh sets a different one per run: Mailpit is shared. */
export const SUPERADMIN_EMAIL = process.env.E2E_SUPERADMIN_EMAIL ?? 'admin@example.com';
