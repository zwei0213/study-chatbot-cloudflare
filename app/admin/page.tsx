import type { Metadata } from "next";
import { Suspense } from "react";
import { StudyAdmin } from "@/components/study-admin";
import { isStudyAdminAuthenticated } from "@/lib/study/admin";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "研究后台",
};

export default function StudyAdminPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 p-8 text-sm text-slate-500">
          正在加载后台…
        </main>
      }
    >
      <StudyAdminContent />
    </Suspense>
  );
}

async function StudyAdminContent() {
  const authenticated = await isStudyAdminAuthenticated();
  return <StudyAdmin initialAuthenticated={authenticated} />;
}
