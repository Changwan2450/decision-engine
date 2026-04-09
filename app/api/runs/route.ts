import { NextResponse } from "next/server";
import { z } from "zod";
import { createRunRecord, listRunRecords } from "@/lib/storage/workspace";

const createRunRequestSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  naturalLanguage: z.string().optional(),
  pastedContent: z.string().optional(),
  urls: z.array(z.string().url()).default([])
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const records = await listRunRecords(projectId);
  return NextResponse.json(records);
}

export async function POST(request: Request) {
  try {
    const body = createRunRequestSchema.parse(await request.json());
    const record = await createRunRecord(body.projectId, {
      title: body.title,
      naturalLanguage: body.naturalLanguage,
      pastedContent: body.pastedContent,
      urls: body.urls
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "런 생성 실패" },
      { status: 400 }
    );
  }
}
