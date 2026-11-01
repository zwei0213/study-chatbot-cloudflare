import { notFound } from "next/navigation";
import { PracticeChat } from "@/components/practice-chat";

type Condition = "low" | "high";

export function generateStaticParams() {
  return [{ condition: "low" }, { condition: "high" }];
}

export default async function PracticePage({
  params,
}: {
  params: Promise<{ condition: string }>;
}) {
  const { condition } = await params;
  if (condition !== "low" && condition !== "high") {
    notFound();
  }
  return <PracticeChat condition={condition as Condition} />;
}
