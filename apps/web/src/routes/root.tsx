import { Link, Outlet } from '@tanstack/react-router';

// Placeholder shell; Task 13 replaces it with the real header and layout.
export function RootLayout() {
  return (
    <div className="mx-auto max-w-5xl px-[clamp(20px,4vw,40px)] py-8">
      <nav className="mb-8 flex items-center gap-6 text-button font-semibold">
        <Link to="/" activeOptions={{ exact: true }} className="[&.active]:text-neutral">
          eHub
        </Link>
        <Link to="/settings" className="[&.active]:text-neutral">
          Settings
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
