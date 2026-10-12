import { notFound } from "next/navigation";
import { StudyChat } from "@/components/study-chat";
import {
  isStudyCondition,
  STUDY_CONDITIONS,
  studyWelcome,
} from "@/lib/study/study";

export function generateStaticParams() {
  return STUDY_CONDITIONS.map((condition) => ({ condition }));
}

export default async function StudyPage({
  params,
}: {
  params: Promise<{ condition: string }>;
}) {
  const { condition } = await params;
  if (!isStudyCondition(condition)) {
    notFound();
  }

  return (
    <StudyChat condition={condition} key={condition} welcome={studyWelcome} />
  );
}
