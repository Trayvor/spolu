/** A contract: a page with a signature line (the knowledge icons' 18 px, stroke 2 style). */
export const ContractIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width={18}
    height={18}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    data-icon="contract"
    className="shrink-0"
  >
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17c1-1.5 2-1.5 3 0s2 1.5 3 0" />
  </svg>
);

/** An expense (Phase 32 E): money going out, a coin with an arrow leaving it. */
export const ExpenseIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width={18}
    height={18}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    data-icon="expense"
    className="shrink-0"
  >
    <circle cx="10" cy="14" r="6" />
    <path d="M10 11.5v5M14.5 3.5H20V9M20 3.5l-6 6" />
  </svg>
);
