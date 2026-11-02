import type { Metadata } from "next";
import { Suspense } from "react";
import { PracticeAdmin } from "@/components/practice-admin";
import { isStudyAdminAuthenticated } from "@/lib/study/admin";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "AI智能陪练实验后台",
};

export default function PracticeAdminPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 p-8 text-sm text-slate-500">
          正在加载后台…
        </main>
      }
    >
      <PracticeAdminContent />
    </Suspense>
  );
}

async function PracticeAdminContent() {
  const authenticated = await isStudyAdminAuthenticated();
  return <PracticeAdmin initialAuthenticated={authenticated} />;
}
