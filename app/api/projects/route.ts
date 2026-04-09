import { NextResponse } from "next/server";
import { z } from "zod";
import { createProjectRecord, listProjectRecords } from "@/lib/storage/workspace";

const createProjectRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1)
});

export async function GET() {
  const records = await listProjectRecords();
  return NextResponse.json(records);
}

export async function POST(request: Request) {
  try {
    const body = createProjectRequestSchema.parse(await request.json());
    const record = await createProjectRecord(body);
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "프로젝트 생성 실패"
      },
      { status: 400 }
    );
  }
}
