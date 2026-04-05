import { RequireAppAdmin } from '../components/RequireAppAdmin';

export default function DiagnosticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RequireAppAdmin>{children}</RequireAppAdmin>;
}
