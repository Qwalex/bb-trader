import { RequireAppAdmin } from '../components/RequireAppAdmin';

export default function FiltersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RequireAppAdmin>{children}</RequireAppAdmin>;
}
