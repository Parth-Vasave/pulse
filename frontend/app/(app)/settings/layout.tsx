import { PageHeader } from "@/components/ui";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" sub="Manage your account, alerts and integrations." />
      <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
        <SettingsNav />
        <div className="flex min-w-0 max-w-2xl flex-col gap-6">{children}</div>
      </div>
    </div>
  );
}
