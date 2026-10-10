import { SettingsTabs } from "./settings-tabs";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <SettingsTabs />
      {children}
    </div>
  );
}
