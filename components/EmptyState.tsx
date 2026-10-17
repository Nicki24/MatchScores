"use client";

import Link from "next/link";
import { Plug, PlayCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import { Button, Card } from "./ui";

export function EmptyState({ title, text }: { title: string; text: string }) {
  const loadDemo = useStore((s) => s.loadDemo);
  return (
    <Card className="mx-auto mt-10 max-w-xl p-8 text-center">
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      <p className="mt-2 text-sm text-slate-400">{text}</p>
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        <Link href="/connecter">
          <Button variant="primary" className="w-full">
            <Plug className="h-4 w-4" /> Connecter Bet261
          </Button>
        </Link>
        <Button variant="outline" onClick={loadDemo}>
          <PlayCircle className="h-4 w-4" /> Charger la démo
        </Button>
      </div>
    </Card>
  );
}
