import { RequireAppAdmin } from '../components/RequireAppAdmin';

export default function TelegramUserbotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RequireAppAdmin>{children}</RequireAppAdmin>;
}
