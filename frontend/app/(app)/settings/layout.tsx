import { PageHeader } from "@/components/ui";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader title="Settings" sub="Manage your account, alerts and integrations." />
      <div className="grid gap-8 border-t border-line pt-8 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-12">
        <SettingsNav />
        <div className="flex min-w-0 max-w-2xl flex-col divide-y divide-line">{children}</div>
      </div>
    </div>
  );
}
